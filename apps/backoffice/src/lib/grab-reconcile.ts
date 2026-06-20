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

// Safety cap on pagination of GET /partner/v1/orders (server sets the page
// size; we walk pages while `more` is true). A busy day stays well under this.
const MAX_ORDER_PAGES = 25;

// Recent dates as YYYY-MM-DD in Asia/Kuala_Lumpur (UTC+8), newest first.
function recentMytDates(days: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    out.push(new Date(now - i * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10));
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Grab's GET /partner/v1/orders returns { orders: [...], more: bool } per the
// official SDK. Tolerate a couple of alternate envelopes; describeShape() below
// surfaces anything we still don't recognise so we fix it from real data, not a
// guess.
function extractOrderArray(res: unknown): GrabListOrder[] {
  if (Array.isArray(res)) return res as GrabListOrder[];
  const o = (res ?? {}) as Record<string, unknown>;
  const cand = o.orders ?? o.statement ?? o.data;
  return (Array.isArray(cand) ? cand : []) as GrabListOrder[];
}

// Compact, PII-free description of a list-orders response: top-level key names,
// the length of any array-valued field, and the field names (not values) of the
// first array element. Recorded when a call yields zero orders so a parser/param
// mismatch is visible in grab_reconcile_runs instead of a silent empty backfill.
function describeShape(res: unknown): Record<string, unknown> {
  if (Array.isArray(res)) {
    const first = res[0];
    return {
      type: "array",
      len: res.length,
      itemKeys: first && typeof first === "object" ? Object.keys(first as object).slice(0, 40) : [],
    };
  }
  if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    const keys = Object.keys(o);
    const arrayCounts: Record<string, number> = {};
    for (const k of keys) if (Array.isArray(o[k])) arrayCounts[k] = (o[k] as unknown[]).length;
    const firstArrKey = keys.find((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length > 0);
    const firstItem = firstArrKey ? (o[firstArrKey] as unknown[])[0] : undefined;
    const itemKeys = firstItem && typeof firstItem === "object" ? Object.keys(firstItem as object).slice(0, 40) : [];
    return { type: "object", keys, arrayCounts, itemKeys };
  }
  return { type: res === null ? "null" : typeof res };
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
      // GET /partner/v1/orders requires `page` (1-indexed) when querying by date
      // and paginates via the response `more` flag — there is no pageSize.
      // Crucially, omitting `page` makes Grab return an EMPTY orders array with
      // NO error, which is exactly the silent-empty backfill we hit before. Walk
      // pages until `more` is false (capped for safety).
      let page = 1;
      let more = true;
      while (more && page <= MAX_ORDER_PAGES) {
        // Grab rate-limits bursts of list-order calls (429); pace them and retry
        // once on a 429 so throttling doesn't blank out an outlet/day.
        let res: unknown;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            res = await listOrders(o.grab_merchant_id, { date, page });
            ok = true;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (attempt === 0 && /\(429\)/.test(msg)) { await sleep(1500); continue; }
            summary.errors++;
            summary.detail.push({ outlet: o.id, date, page, error: msg });
          }
        }
        if (!ok) break;

        const arr = extractOrderArray(res);
        more = Boolean((res as Record<string, unknown> | null)?.more);
        if (arr.length === 0) {
          // No orders on this page — record a compact diagnostic on the first
          // page (so a future param/shape regression surfaces) and stop walking.
          if (page === 1) {
            summary.detail.push({ outlet: o.id, date, empty: true, more, shape: describeShape(res) });
          }
          break;
        }
        for (const go of arr) {
          const id = extractOrderId(go);
          if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          orders.push(go);
        }
        page++;
        if (more) await sleep(400);
      }
      await sleep(400);
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
