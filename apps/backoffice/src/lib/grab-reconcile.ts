/**
 * GrabFood order reconciliation — the safety net that guarantees no Grab order
 * stays missing from pos_orders (lost docket AND lost revenue).
 *
 * For each linked outlet: pull Grab's own order list (listOrders), diff it
 * against pos_orders by external_id, and for anything Grab has that we don't:
 *   1. REPLAY from the captured raw webhook payload if we have one (full
 *      backfill — items, totals, docket), via the same ingestGrabOrder the live
 *      webhook uses; else
 *   2. MINIMAL backfill from the order summary (external_id + total + status) so
 *      the sale + the order are never lost, flagged "[reconciled]".
 *
 * Runs on a cron (every ~15 min) and is also callable on demand. It only ever
 * INSERTS missing orders — it never edits or deletes existing rows.
 */

import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { isGrabConfigured, listOrders } from "@/lib/grab";
import { ingestGrabOrder, type GrabWebhookPayload } from "@/lib/grab-ingest";

type GrabListOrder = Record<string, unknown>;

function pick(o: GrabListOrder, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}
function extractOrderId(o: GrabListOrder): string | null {
  const v = pick(o, "orderID", "orderId", "id");
  return typeof v === "string" && v ? v : null;
}
function extractShort(o: GrabListOrder): string {
  const v = pick(o, "shortOrderNumber", "shortOrderID", "shortOrderId", "displayID", "displayId");
  return v != null ? String(v) : "";
}
function extractState(o: GrabListOrder): string {
  const v = pick(o, "state", "orderState", "status");
  return v != null ? String(v).toUpperCase() : "";
}
function extractTotalSen(o: GrabListOrder): number {
  const price = o.price as Record<string, unknown> | undefined;
  if (price && typeof price.subtotal === "number") {
    return price.subtotal + (Number(price.merchantChargeFee) || 0) + (Number(price.serviceChargeFee) || 0);
  }
  const t = pick(o, "total", "amount", "totalAmount", "totalPrice");
  return typeof t === "number" ? t : 0;
}

// Reconciled orders come from Grab's (mostly finished) order list, so default
// to a terminal status — a reconciled order must NEVER be created onto the live
// on-register KDS or get auto-accepted.
function reconcileStatus(state: string): string {
  const s = state.toUpperCase();
  if (/CANCEL|FAIL|REJECT/.test(s)) return "cancelled";
  return "completed";
}

// How many recent days of Grab order history to reconcile each run — today +
// yesterday (MYT) covers the local business day and the UTC-midnight boundary.
const RECONCILE_DAYS = 2;

// Recent dates as YYYY-MM-DD in Asia/Kuala_Lumpur (UTC+8), newest first.
function recentMytDates(days: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    out.push(new Date(now - i * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10));
  }
  return out;
}

export interface ReconcileSummary {
  outlets: number;
  grabOrders: number;
  missing: number;
  backfilledFull: number;
  backfilledMinimal: number;
  errors: number;
  detail: Array<Record<string, unknown>>;
}

export async function reconcileGrabOrders(): Promise<ReconcileSummary> {
  const db = getSupabaseAdmin();
  const summary: ReconcileSummary = {
    outlets: 0, grabOrders: 0, missing: 0, backfilledFull: 0, backfilledMinimal: 0, errors: 0, detail: [],
  };

  if (!isGrabConfigured()) {
    summary.detail.push({ skipped: "grab-not-configured" });
    await record(db, summary);
    return summary;
  }

  const { data: outlets } = await db
    .from("outlets").select("id, grab_merchant_id").not("grab_merchant_id", "is", null);

  // Grab's GET /partner/v1/orders REQUIRES a `date` (YYYY-MM-DD) and returns
  // one day at a time, so query the last few MYT days and merge (deduped by
  // order id). MYT covers the local business day + the UTC-midnight boundary.
  const dates = recentMytDates(RECONCILE_DAYS);

  for (const o of (outlets ?? []) as Array<{ id: string; grab_merchant_id: string }>) {
    summary.outlets++;
    const orders: GrabListOrder[] = [];
    const seen = new Set<string>();
    for (const date of dates) {
      try {
        const res = await listOrders(o.grab_merchant_id, { date });
        const arr = (Array.isArray(res)
          ? res
          : ((res as Record<string, unknown>)?.orders
              ?? (res as Record<string, unknown>)?.statement
              ?? (res as Record<string, unknown>)?.data
              ?? [])) as GrabListOrder[];
        for (const go of arr) {
          const id = extractOrderId(go);
          if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          orders.push(go);
        }
      } catch (e) {
        summary.errors++;
        summary.detail.push({ outlet: o.id, date, error: e instanceof Error ? e.message : String(e) });
      }
    }
    summary.grabOrders += orders.length;

    for (const go of orders) {
      const ext = extractOrderId(go);
      if (!ext) continue;

      const { data: existing } = await db
        .from("pos_orders").select("id").eq("external_id", ext).maybeSingle();
      if (existing) continue;

      summary.missing++;
      const status = reconcileStatus(extractState(go));

      // 1. Full backfill: replay the captured raw webhook payload if we have one.
      const { data: ev } = await db
        .from("grab_webhook_events")
        .select("raw")
        .eq("order_id", ext)
        .gt("item_count", 0)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ev?.raw) {
        try {
          const r = await ingestGrabOrder(db, ev.raw as GrabWebhookPayload, {
            autoAccept: false, statusOverride: status, originTag: "[reconciled]",
          });
          if (r.action === "created" || r.action === "duplicate") {
            summary.backfilledFull++;
            summary.detail.push({ order: ext, outlet: o.id, via: "replay", status });
            continue;
          }
        } catch (e) {
          summary.detail.push({ order: ext, replayError: e instanceof Error ? e.message : String(e) });
        }
      }

      // 2. Minimal backfill — order + total + status, so the sale isn't lost.
      try {
        const short = extractShort(go).replace(/^GF-/i, "");
        const totalSen = extractTotalSen(go);
        const { error } = await db.from("pos_orders").insert({
          external_id: ext,
          order_number: `GF-${short || ext.slice(0, 6)}`,
          outlet_id: o.id,
          source: "grabfood",
          order_type: "takeaway",
          status,
          subtotal: totalSen, sst_amount: 0, discount_amount: 0, total: totalSen,
          customer_name: "Grab Customer",
          notes: "[reconciled] backfilled from Grab order list — item detail unavailable",
        });
        if (error && (error as { code?: string }).code !== "23505") throw error;
        summary.backfilledMinimal++;
        summary.detail.push({ order: ext, outlet: o.id, via: "minimal", status, totalSen });
      } catch (e) {
        summary.errors++;
        summary.detail.push({ order: ext, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  await record(db, summary);
  if (summary.missing > 0) {
    // Surfaced as an error-level log so a recurring drop is visible, not silent.
    console.error(
      `[grab:reconcile] backfilled ${summary.missing} missing order(s) — full=${summary.backfilledFull} minimal=${summary.backfilledMinimal} errors=${summary.errors}`,
    );
  }
  return summary;
}

async function record(db: ReturnType<typeof getSupabaseAdmin>, s: ReconcileSummary) {
  try {
    await db.from("grab_reconcile_runs").insert({
      id: randomUUID(),
      outlets: s.outlets,
      grab_orders: s.grabOrders,
      missing: s.missing,
      backfilled_full: s.backfilledFull,
      backfilled_minimal: s.backfilledMinimal,
      errors: s.errors,
      detail: s.detail.slice(0, 200),
    });
  } catch (e) {
    console.warn("[grab:reconcile] run log skipped:", e instanceof Error ? e.message : e);
  }
}
