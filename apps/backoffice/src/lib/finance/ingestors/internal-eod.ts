// Internal EOD ingestor — the StoreHub-free replacement for storehub-eod.ts.
//
// Builds the SAME `EodSummary` the AR agent already consumes, but from our own
// infra instead of a third-party POS:
//   - in-store sales:  pos_orders + pos_order_payments  (POS-native)
//   - online / pickup: orders                            (order/pickup app)
//
// The money math lives in internal-eod-aggregate.ts (pure, unit-tested). This
// file is the IO shell: fetch rows, persist the source blob, post via the AR
// agent, with the same idempotency guard as the StoreHub path.
//
// Outlet identity (the mapping gap called out in the finance spec): journals
// key on the Outlet UUID, but pos_orders.outlet_id is a POS code ("outlet-sa")
// and orders.store_id is a slug ("shah-alam"). posCodeForOutlet resolves
// UUID -> {posCode, storeId} so the rest of the pipeline only sees the UUID.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "../supabase";
import { postDailyAr } from "../agents/ar";
import { resolveCompanyFromOutlet, getDefaultCompanyId } from "../companies";
import type { IngestEodResult } from "./storehub-eod";
import {
  aggregateInternalEod,
  posCodeForOutlet,
  mytDateOf,
  type PosOrderRow,
  type PosPaymentRow,
  type AppOrderRow,
} from "./internal-eod-aggregate";

// ── Persist the raw blob for provenance + Matcher replay ────────────────────
async function persistInternalDoc(
  companyId: string,
  outletId: string,
  posCode: string | null,
  storeId: string | null,
  date: string,
  payload: { posOrders: PosOrderRow[]; posPayments: PosPaymentRow[]; appOrders: AppOrderRow[] }
): Promise<string> {
  const client = getFinanceClient();
  const sourceRef = `internal-eod-${outletId}-${date}`;

  const { data: existing } = await client
    .from("fin_documents")
    .select("id")
    .eq("source", "pos_native")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const id = randomUUID();
  const { error } = await client.from("fin_documents").insert({
    id,
    company_id: companyId,
    source: "pos_native",
    source_ref: sourceRef,
    doc_type: "pos_eod",
    outlet_id: outletId,
    raw_text: null,
    metadata: {
      date,
      posCode,
      storeId,
      posOrderCount: payload.posOrders.length,
      appOrderCount: payload.appOrders.length,
      // Full payloads for replay + per-rail Matcher reconciliation.
      posOrders: payload.posOrders,
      posPayments: payload.posPayments,
      appOrders: payload.appOrders,
    },
    received_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    status: "processed",
  });
  if (error) throw error;
  return id;
}

// ── Ingest one outlet for one date (idempotent, mirrors storehub-eod) ───────
export async function ingestOutletEodInternal(outletId: string, date: string): Promise<IngestEodResult> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, pickupStoreId: true },
  });
  if (!outlet) {
    return { outletId, outletName: "?", date, transactionsFetched: 0, error: "outlet not found" };
  }

  const posCode = posCodeForOutlet(outlet);
  const storeId = outlet.pickupStoreId;
  if (!posCode && !storeId) {
    return { outletId, outletName: outlet.name, date, transactionsFetched: 0, skipped: "no pos code / store id" };
  }

  const client = getFinanceClient();
  // Idempotency: one AR journal per outlet/date. Shared guard with the StoreHub
  // path means whichever ingester runs first wins; the other no-ops.
  const { data: existingTxn } = await client
    .from("fin_transactions")
    .select("id, amount")
    .eq("outlet_id", outletId)
    .eq("txn_date", date)
    .eq("txn_type", "ar_invoice")
    .eq("posted_by_agent", "ar")
    .maybeSingle();
  if (existingTxn?.id) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      posted: { transactionId: existingTxn.id as string, amount: Number(existingTxn.amount) },
      skipped: "already posted",
    };
  }

  const startUTC = new Date(`${date}T00:00:00+08:00`).toISOString();
  const endUTC = new Date(`${date}T23:59:59.999+08:00`).toISOString();

  let posOrders: PosOrderRow[] = [];
  let posPayments: PosPaymentRow[] = [];
  let appOrders: AppOrderRow[] = [];

  try {
    if (posCode) {
      const { data: po, error: poErr } = await client
        .from("pos_orders")
        .select("id, status, refund_of_order_id, sst_amount, total, created_at")
        .eq("outlet_id", posCode)
        .gte("created_at", startUTC)
        .lte("created_at", endUTC)
        .limit(20000);
      if (poErr) throw poErr;
      posOrders = (po ?? []) as PosOrderRow[];

      const ids = posOrders.map((o) => o.id);
      if (ids.length) {
        const { data: pp, error: ppErr } = await client
          .from("pos_order_payments")
          .select("order_id, payment_method, amount, refund_amount")
          .in("order_id", ids.slice(0, 5000))
          .limit(20000);
        if (ppErr) throw ppErr;
        posPayments = (pp ?? []) as PosPaymentRow[];
      }
    }
    if (storeId) {
      const { data: ao, error: aoErr } = await client
        .from("orders")
        .select("id, status, payment_method, subtotal, sst_amount, total, created_at")
        .eq("store_id", storeId)
        .gte("created_at", startUTC)
        .lte("created_at", endUTC)
        .limit(20000);
      if (aoErr) throw aoErr;
      appOrders = (ao ?? []) as AppOrderRow[];
    }
  } catch (err) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const fetched = posOrders.length + appOrders.length;
  if (fetched === 0) {
    return { outletId, outletName: outlet.name, date, transactionsFetched: 0, skipped: "no transactions" };
  }

  const companyId = (await resolveCompanyFromOutlet(outletId)) ?? (await getDefaultCompanyId());
  const docId = await persistInternalDoc(companyId, outletId, posCode, storeId, date, {
    posOrders,
    posPayments,
    appOrders,
  });

  const summary = aggregateInternalEod({
    companyId,
    outletId,
    outletName: outlet.name,
    date,
    posOrders,
    posPayments,
    appOrders,
    sourceDocId: docId,
  });

  if (summary.netSales <= 0) {
    return { outletId, outletName: outlet.name, date, transactionsFetched: fetched, skipped: "zero net sales" };
  }

  try {
    const result = await postDailyAr(summary);
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: fetched,
      posted: { transactionId: result.transactionId, amount: result.amount },
    };
  } catch (err) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: fetched,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Ingest every outlet that has cut over to POS-native on/before `date`.
// Outlets still on StoreHub (posNativeCutoverAt null, or cutover after `date`)
// are left to the StoreHub ingester — this is the routing that prevents a
// double post during the transition.
export async function ingestAllOutletsEodInternal(date: string): Promise<IngestEodResult[]> {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", posNativeCutoverAt: { not: null } },
    select: { id: true, posNativeCutoverAt: true },
  });
  const results: IngestEodResult[] = [];
  for (const o of outlets) {
    if (o.posNativeCutoverAt && mytDateOf(o.posNativeCutoverAt) <= date) {
      results.push(await ingestOutletEodInternal(o.id, date));
    }
  }
  return results;
}
