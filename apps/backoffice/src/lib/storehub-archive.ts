// Keeps the StoreHub sales archive (public.storehub_sales) fresh for outlets that
// are still on StoreHub. The one-time historical backfill
// (scripts/backfill-storehub-sales.ts) seeded the archive; this incremental sync
// — run daily via /api/cron/storehub-sync — pulls the last few days so the
// repointed sales dashboard stays current for outlets still on StoreHub —
// including cut-over outlets, whose Grab/Beep (online) orders still route through
// StoreHub even after the till moves to POS-native. Idempotent (upsert on
// storehub_store_id+ref_id), so re-runs and overlapping windows are safe.
//
// Scope note: this syncs storehub_sales (the dashboard's source — transaction-level
// revenue/rounds/channels). It does NOT refresh storehub_sale_items (the menu-level
// archive), which stays a backfill snapshot — re-extract that from raw if/when a
// product-analytics view needs incremental line items.

import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { classifyChannel, isDeliveryOrQR } from "@/app/api/sales/_lib/storehub-helpers";
import type { StoreHubTransaction } from "@/lib/storehub";

const BASE_URL = "https://api.storehubhq.com";
const MAX_TXN = 5000;
const ONE_DAY = 86_400_000;

type ShTxn = {
  refId: string; total?: number; subTotal?: number; items?: unknown[];
  channel?: string; orderType?: string; transactionType?: string;
  isCancelled?: boolean; status?: string | null;
  transactionTime?: string; createdAt?: string; completedAt?: string;
  [k: string]: unknown;
};

export type SyncResult = { outlet: string; synced: number; skipped?: boolean; error?: string };

function authHeader(): string {
  const id = process.env.STOREHUB_ACCOUNT_ID;
  const key = process.env.STOREHUB_API_KEY;
  if (!id || !key) throw new Error("Missing STOREHUB_ACCOUNT_ID / STOREHUB_API_KEY");
  return "Basic " + Buffer.from(`${id}:${key}`).toString("base64");
}
const fmtDate = (d: Date) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().split("T")[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txnTime = (t: ShTxn) => t.transactionTime ?? t.completedAt ?? t.createdAt ?? null;

async function fetchWindow(storeId: string, from: Date, to: Date): Promise<ShTxn[]> {
  const url = new URL("/transactions", BASE_URL);
  url.searchParams.set("storeId", storeId);
  url.searchParams.set("from", fmtDate(from));
  url.searchParams.set("to", fmtDate(to));
  url.searchParams.set("includeOnline", "true");
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`StoreHub ${res.status}: ${await res.text()}`);
  return (await res.json()) as ShTxn[];
}

/**
 * Pull the last `days` of StoreHub transactions for each outlet still on StoreHub
 * and upsert them into storehub_sales. Outlets more than 7 days past their
 * posNativeCutoverAt are skipped (their StoreHub register is off / account may be
 * cancelled). Per-outlet errors are captured, not thrown — one bad outlet never
 * blocks the rest.
 */
export async function syncRecentStorehubSales(days = 3): Promise<SyncResult[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase service env");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const outlets = await prisma.outlet.findMany({
    where: { storehubId: { not: null } },
    select: { id: true, name: true, storehubId: true, posNativeCutoverAt: true },
  });

  const now = new Date();
  const from = new Date(now.getTime() - days * ONE_DAY);
  const results: SyncResult[] = [];

  for (const o of outlets) {
    // Do NOT skip cut-over outlets: Grab/Beep (online) orders still flow through
    // StoreHub even after the till moves to POS-native, so the archive must keep
    // ingesting until StoreHub is fully retired (Grab moved to POS-native too).
    // A cancelled StoreHub account just errors per-outlet (caught below).
    try {
      const txns = await fetchWindow(o.storehubId!, from, now);
      if (txns.length >= MAX_TXN) {
        console.warn(`[storehub-sync] ${o.name} hit ${MAX_TXN} in a ${days}-day window — widen guard`);
      }
      const seen = new Map<string, ShTxn>();
      for (const t of txns) if (t?.refId != null) seen.set(String(t.refId), t);
      const rows = [...seen.values()].map((t) => ({
        outlet_id: o.id,
        storehub_store_id: o.storehubId!,
        ref_id: String(t.refId),
        transaction_time: txnTime(t),
        total: typeof t.total === "number" ? t.total : null,
        sub_total: typeof t.subTotal === "number" ? t.subTotal : null,
        channel: t.channel ?? null,
        order_type: t.orderType ?? null,
        transaction_type: t.transactionType ?? null,
        status: t.status ?? null,
        is_cancelled: !!t.isCancelled,
        item_count: Array.isArray(t.items) ? t.items.length : null,
        // Classified at WRITE time (the JS classifier stays canonical) so
        // dashboard reads never ship/reclassify the raw JSONB again. The
        // SQL twins classify_storehub_channel/is_storehub_delivery_qr
        // exist for backfills — parity-verified against this classifier.
        // ShTxn is a local trimmed view of the same payload; the classifier
        // reads dynamic string fields, so the cast is shape-safe.
        channel_class: classifyChannel(t as unknown as StoreHubTransaction),
        is_delivery_qr: isDeliveryOrQR(t as unknown as StoreHubTransaction),
        raw: t,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("storehub_sales")
          .upsert(rows.slice(i, i + 500), { onConflict: "storehub_store_id,ref_id" });
        if (error) throw new Error(error.message);
      }
      results.push({ outlet: o.name, synced: rows.length });
      await sleep(350); // stay under StoreHub's 3 req/s
    } catch (e) {
      results.push({ outlet: o.name, synced: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
