// One-off backfill — repairs AR for the StoreHub→native cutover window.
//
// While the live finance-eod cron was still StoreHub-only, each outlet's AR was
// understated from its cutover onward: it booked only the dying StoreHub Grab
// tail, not the native till/app revenue (~RM46k across con+sa). This walks a
// date range and, per outlet that was native on that day:
//   • if a stale StoreHub-sourced ar_invoice exists → reverseTransaction() it,
//   • re-post the day via the native ingestor (pos_orders + pickup orders, plus
//     the StoreHub GRABFOOD/BEEP archive for days before Grab went native —
//     handled by ingestOutletNativeEod's includeStorehubDelivery flag).
//
// SAFE BY DEFAULT: dryRun unless `?dryRun=false`. Idempotent — a day already
// re-posted from pos_native is skipped. Auth: CRON_SECRET bearer.
//
//   GET /api/cron/finance-eod-backfill?from=2026-06-08&to=2026-06-17&dryRun=false

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { reverseTransaction } from "@/lib/finance/ledger";
import { AR_AGENT_VERSION } from "@/lib/finance/agents/ar";
import { ingestOutletNativeEod, isNativeOnDate } from "@/lib/finance/ingestors/pos-native-eod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Inclusive list of YYYY-MM-DD between from..to. Anchored at noon UTC so day
// arithmetic never trips on offsets.
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

type BackfillResult = {
  date: string;
  outlet: string;
  action: "skip" | "would-repost" | "would-post" | "reposted" | "posted";
  reason?: string;
  reversedAmount?: number;
  posted?: { transactionId: string; amount: number };
  skipped?: string;
  error?: string;
};

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const dryRun = url.searchParams.get("dryRun") !== "false"; // default true
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", posNativeCutoverAt: { not: null } },
    select: { id: true, name: true, posNativeCutoverAt: true, loyaltyOutletId: true, pickupStoreId: true },
  });
  const client = getFinanceClient();
  const dates = eachDate(from, to);
  const results: BackfillResult[] = [];

  for (const date of dates) {
    for (const o of outlets) {
      if (!isNativeOnDate(date, o.posNativeCutoverAt)) continue;

      // Existing, non-reversed AR journal for this outlet/day (if any).
      const { data: existing } = await client
        .from("fin_transactions")
        .select("id, amount, source_doc_id")
        .eq("outlet_id", o.id)
        .eq("txn_date", date)
        .eq("txn_type", "ar_invoice")
        .eq("posted_by_agent", "ar")
        .neq("status", "reversed")
        .maybeSingle();

      // Is it already native (a prior backfill)? Then there's nothing to do.
      let existingSource: string | null = null;
      if (existing?.source_doc_id) {
        const { data: doc } = await client
          .from("fin_documents").select("source").eq("id", existing.source_doc_id).maybeSingle();
        existingSource = (doc?.source as string) ?? null;
      }
      if (existing && existingSource === "pos_native") {
        results.push({ date, outlet: o.name, action: "skip", reason: "already native" });
        continue;
      }

      if (dryRun) {
        results.push({
          date, outlet: o.name,
          action: existing ? "would-repost" : "would-post",
          reversedAmount: existing ? Number(existing.amount) : 0,
        });
        continue;
      }

      try {
        if (existing) {
          await reverseTransaction(existing.id as string, {
            reason: "StoreHub→native cutover backfill: replace partial StoreHub EOD with native",
            agent: "ar",
            agentVersion: AR_AGENT_VERSION,
          });
        }
        const r = await ingestOutletNativeEod(o, date, { includeStorehubDelivery: true });
        results.push({
          date, outlet: o.name,
          action: existing ? "reposted" : "posted",
          reversedAmount: existing ? Number(existing.amount) : 0,
          posted: r.posted, skipped: r.skipped, error: r.error,
        });
      } catch (err) {
        results.push({ date, outlet: o.name, action: existing ? "reposted" : "posted", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const summary = {
    from, to, dryRun, days: dates.length,
    actions: results.length,
    reposted: results.filter((r) => r.action === "reposted" || r.action === "posted").length,
    skipped: results.filter((r) => r.action === "skip").length,
    errors: results.filter((r) => r.error).length,
    repostedAmount: Math.round(results.reduce((s, r) => s + (r.posted?.amount ?? 0), 0) * 100) / 100,
  };
  return NextResponse.json({ summary, results });
}
