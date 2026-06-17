// Nightly close orchestrator — runs the loop end to end for one day:
//   1. EOD ingest   → AR journals + channel-tagged invoices (per outlet, routed
//                     StoreHub vs internal)
//   2. Matcher      → reconcile bank lines over a trailing window against open
//                     invoices/bills (settlements land a few days after the
//                     sale; re-scanning is idempotent — matched lines drop out)
//   3. Anomaly sweep→ surface integrity problems over the same window
//
// Each step is independently idempotent, so the whole job is safe to re-run for
// a date. Steps don't short-circuit each other: a Matcher failure still lets the
// Anomaly sweep run, and vice versa — each is reported in the result.

import { ingestAllOutletsEodRouted } from "./ingestors/eod-router";
import { syncBukkuBankFeed, type BukkuSyncResult } from "./ingestors/bukku-bank";
import { runMatcher, type MatcherSummary } from "./agents/matcher";
import { runAnomalySweep, type AnomalySummary } from "./agents/anomaly";

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export type NightlyResult = {
  date: string;
  window: { from: string; to: string };
  eod: {
    outlets: number;
    posted: number;
    skipped: number;
    errors: number;
    bySource: { internal: number; storehub: number; skipped: number };
    totalAmount: number;
  };
  bankFeed: BukkuSyncResult | { error: string } | { skipped: string };
  match: MatcherSummary | { error: string };
  anomaly: AnomalySummary | { error: string };
};

export async function runNightlyClose(date: string, opts: { lookbackDays?: number } = {}): Promise<NightlyResult> {
  const lookback = opts.lookbackDays ?? 7;
  const from = addDays(date, -lookback);

  // 0. Pull the Bukku bank feed over the window so the Matcher has fresh lines.
  //    No-ops cleanly until a Bukku-enabled outlet has a valid token.
  let bankFeed: NightlyResult["bankFeed"];
  try {
    bankFeed = await syncBukkuBankFeed({ from, to: date });
  } catch (err) {
    bankFeed = { error: err instanceof Error ? err.message : String(err) };
  }

  // 1. EOD ingest for the day.
  const eodResults = await ingestAllOutletsEodRouted(date);
  const eod = {
    outlets: eodResults.length,
    posted: eodResults.filter((r) => r.posted).length,
    skipped: eodResults.filter((r) => r.skipped).length,
    errors: eodResults.filter((r) => r.error).length,
    bySource: {
      internal: eodResults.filter((r) => r.source === "internal").length,
      storehub: eodResults.filter((r) => r.source === "storehub").length,
      skipped: eodResults.filter((r) => r.source === "skipped").length,
    },
    totalAmount: eodResults.reduce((s, r) => s + (r.posted?.amount ?? 0), 0),
  };

  // 2. Matcher over the trailing window — don't let a failure block the sweep.
  let match: MatcherSummary | { error: string };
  try {
    match = await runMatcher({ from, to: date });
  } catch (err) {
    match = { error: err instanceof Error ? err.message : String(err) };
  }

  // 3. Anomaly sweep over the same window.
  let anomaly: AnomalySummary | { error: string };
  try {
    anomaly = await runAnomalySweep({ from, to: date });
  } catch (err) {
    anomaly = { error: err instanceof Error ? err.message : String(err) };
  }

  return { date, window: { from, to: date }, eod, bankFeed, match, anomaly };
}
