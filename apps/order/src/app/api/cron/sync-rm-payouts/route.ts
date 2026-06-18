export const dynamic = "force-dynamic";
// One RM settlement round-trip per (method, sequence) per day. Batch and bail
// before the deadline; leftovers re-sync on the next run (upserts are idempotent).
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  getDailySettlementReport,
  parseSettlementCsv,
  SETTLEMENT_METHODS,
  type SettlementLine,
} from "@/lib/revenue-monster/client";

/**
 * Sync Revenue Monster daily settlement (payout) batches into RmPayout /
 * RmPayoutLine for the backoffice finance Payouts tab.
 *
 *   GET ?probe=true&date=YYYY-MM-DD[&method=FPX_MY]  → raw + parsed sample, no writes
 *   GET ?date=YYYY-MM-DD                              → sync that day
 *   GET ?days=N                                       → backfill last N days
 *   (no params)                                       → sync yesterday (cron default)
 *
 * Idempotent: payouts keyed on (date, method, sequence, store), lines on the RM
 * transaction id, so re-running a day upserts in place. RM pauses settlement on
 * public holidays — a missed day simply backfills on a later run.
 */

const SEQ_CAP = 10; // safety bound on settlement batches per method/day

// MYT (UTC+8) calendar date string, offset by `daysAgo`.
function mytDate(daysAgo: number): string {
  const ms = Date.now() + 8 * 3_600_000 - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Map an RM store label (and/or the matched Celsius order's store) to our outlet
// slug + operating entity. Mirrors the bank-line classifier's name heuristics.
function resolveStore(storeName: string | null, orderStore: string | null): { slug: string; entity: string } {
  const s = (orderStore || storeName || "").toLowerCase();
  if (s.includes("conezion") || s === "conezion") return { slug: "conezion", entity: "Celsius Coffee Conezion Sdn Bhd" };
  if (s.includes("tamarind") || s === "tamarind") return { slug: "tamarind", entity: "Celsius Coffee Tamarind Sdn Bhd" };
  if (s.includes("shah") || s.includes("alam") || s === "shah-alam") return { slug: "shah-alam", entity: "Celsius Coffee Sdn Bhd" };
  return { slug: orderStore || "unknown", entity: storeName || "Unknown" };
}

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const p = request.nextUrl.searchParams;

  // ── Probe: one call, raw + parsed, no DB writes. Fail-fast endpoint check. ──
  if (p.get("probe") === "true") {
    const date = p.get("date") || mytDate(7);
    const method = p.get("method") || "FPX_MY";
    const r = await getDailySettlementReport({ date, method, sequence: 1 });
    const parsed = parseSettlementCsv(r.body);
    return NextResponse.json({
      probe: { date, method },
      http: { ok: r.ok, status: r.status, bodyLength: r.body.length },
      bodyHead: r.body.slice(0, 3000),
      parsed: { lineCount: parsed.lines.length, grossSen: parsed.grossSen, mdrSen: parsed.mdrSen, netSen: parsed.netSen, sample: parsed.lines.slice(0, 3) },
    });
  }

  // ── Determine the date window ──
  const days = Math.min(Math.max(Number(p.get("days") ?? 0) || 0, 0), 90);
  const dates = p.get("date")
    ? [p.get("date") as string]
    : days > 0
      ? Array.from({ length: days }, (_, i) => mytDate(i + 1))
      : [mytDate(1)]; // default: yesterday

  const supabase = getSupabaseAdmin();
  const result = { dates, payouts: 0, lines: 0, linked: 0, methodsSeen: [] as string[], errors: [] as string[] };
  const DEADLINE_MS = 50_000;
  const startedAt = Date.now();

  for (const date of dates) {
    for (const method of SETTLEMENT_METHODS) {
      if (Date.now() - startedAt > DEADLINE_MS) { result.errors.push("deadline reached; remaining will sync next run"); return NextResponse.json(result); }
      for (let seq = 1; seq <= SEQ_CAP; seq++) {
        let parsedLines: SettlementLine[] = [];
        try {
          const r = await getDailySettlementReport({ date, method, sequence: seq });
          if (!r.ok) break;                       // no batch / not enabled for this method
          parsedLines = parseSettlementCsv(r.body).lines;
        } catch (e) {
          result.errors.push(`${date} ${method} seq${seq}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (parsedLines.length === 0) break;       // no more batches this method/day
        if (!result.methodsSeen.includes(method)) result.methodsSeen.push(method);

        // Link each line to its Celsius order via payment_provider_ref (RM txn id).
        const txIds = parsedLines.map((l) => l.rmTransactionId);
        const { data: orderRows } = await supabase
          .from("orders")
          .select("id, store_id, payment_provider_ref")
          .in("payment_provider_ref", txIds);
        const orderByRef = new Map<string, { id: string; store_id: string | null }>();
        for (const o of (orderRows ?? []) as { id: string; store_id: string | null; payment_provider_ref: string | null }[]) {
          if (o.payment_provider_ref) orderByRef.set(o.payment_provider_ref, { id: o.id, store_id: o.store_id });
        }

        // Group lines into per-store payouts (matches the portal's per-entity rows).
        type Group = { slug: string; entity: string; lines: { line: SettlementLine; orderId: string | null }[] };
        const groups = new Map<string, Group>();
        for (const line of parsedLines) {
          const matched = orderByRef.get(line.rmTransactionId) ?? null;
          const { slug, entity } = resolveStore(line.store, matched?.store_id ?? null);
          if (!groups.has(slug)) groups.set(slug, { slug, entity, lines: [] });
          groups.get(slug)!.lines.push({ line, orderId: matched?.id ?? null });
        }

        for (const g of groups.values()) {
          const payoutId = `${date}_${method}_${seq}_${g.slug}`;
          const grossSen = g.lines.reduce((s, x) => s + x.line.grossSen, 0);
          const mdrSen   = g.lines.reduce((s, x) => s + x.line.mdrFeeSen, 0);
          const netSen   = g.lines.reduce((s, x) => s + x.line.netSen, 0);

          const { error: pErr } = await supabase.from("RmPayout").upsert({
            id: payoutId,
            settlementDate: date,
            method,
            sequence: seq,
            storeId: g.slug,
            entityName: g.entity,
            txnCount: g.lines.length,
            grossTotal: grossSen / 100,
            mdrFee: mdrSen / 100,
            netTotal: netSen / 100,
            status: "success",
            syncedAt: new Date().toISOString(),
          }, { onConflict: "id" });
          if (pErr) { result.errors.push(`payout ${payoutId}: ${pErr.message}`); continue; }
          result.payouts += 1;

          const lineRows = g.lines.map(({ line, orderId }) => ({
            id: line.rmTransactionId,
            payoutId,
            rmTransactionId: line.rmTransactionId,
            rmOrderId: line.rmOrderId,
            orderId,
            gross: line.grossSen / 100,
            mdrFee: line.mdrFeeSen / 100,
            net: line.netSen / 100,
            method,
            txnTime: line.txnTime,
          }));
          const { error: lErr } = await supabase.from("RmPayoutLine").upsert(lineRows, { onConflict: "id" });
          if (lErr) { result.errors.push(`lines ${payoutId}: ${lErr.message}`); continue; }
          result.lines += lineRows.length;
          result.linked += lineRows.filter((l) => l.orderId).length;
        }
      }
    }
  }

  return NextResponse.json(result);
}
