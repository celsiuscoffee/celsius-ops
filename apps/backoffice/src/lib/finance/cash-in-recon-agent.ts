// Cash-In Reconciliation agent — the settlement watchdog.
//
// A member of the finance agent family. ADVISORY: it never posts or moves
// money. Once a week it reconciles revenue rung up against cash that actually
// landed in the bank, per entity per channel (cashInReconByChannel), and flags
// every channel whose gap exceeds the expected fee/commission band — i.e. money
// rung that has not arrived. Each flag logs to fin_agent_decisions (shared
// ledger, measurable from day one) and surfaces to a Telegram digest.
//
// Cadence: settlements complete over T+1..T+3, so the agent reconciles a fully
// settled trailing week (ends 2 days ago) rather than yesterday. Wired into the
// daily finance-eod cron, gated to fire once a week (Monday MYT), so no new
// Vercel cron slot is consumed (the repo sits at the 38-cron budget).

import { randomUUID } from "crypto";
import { getFinanceClient } from "@/lib/finance/supabase";
import { sendMessage } from "@/lib/telegram";
import { cashInReconByChannel, type CashInChannel } from "@/lib/finance/cash-in-recon";

export const CASH_IN_AGENT_VERSION = "cash-in-recon-v1";

// Settlement buffer: the last day of the reconciled window must be at least
// this many days in the past so every channel has had time to settle.
const SETTLE_BUFFER_DAYS = 2;
const WINDOW_DAYS = 7;

const CASHIN_ENTITY: Record<string, string> = {
  celsius: "Shah Alam+Nilai",
  celsiusconezion: "Putrajaya",
  celsiustamarind: "Cyberjaya",
  group: "Group",
};
const CASHIN_CHANNEL: Record<string, string> = {
  card: "Card", qr: "QR", online: "Online", grab: "Grab", consignment: "Consignment",
};
const rm = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;

function mytDateNDaysAgo(n: number): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  myt.setUTCDate(myt.getUTCDate() - n);
  return myt.toISOString().slice(0, 10);
}

// The trailing fully-settled week: [buffer+7 days ago, buffer days ago].
export function settledWeekWindow(): { from: string; to: string } {
  return { from: mytDateNDaysAgo(SETTLE_BUFFER_DAYS + WINDOW_DAYS - 1), to: mytDateNDaysAgo(SETTLE_BUFFER_DAYS) };
}

export type CashInFinding = {
  company: string;
  channel: CashInChannel["channel"];
  severity: "info" | "warn";
  revenue: number;
  banked: number;
  gap: number;
  gapPct: number | null;
  detail: string;
};

// Turn the review rows into findings. A positive gap beyond the band is money
// rung that has not arrived (warn); a negative gap (banked > rung) is a timing
// spill or misclassified credit (info).
export function findingsFromRecon(rows: CashInChannel[]): CashInFinding[] {
  return rows
    .filter((r) => r.status === "review")
    .map((r) => {
      const severity: CashInFinding["severity"] = (r.gap ?? 0) > 0 ? "warn" : "info";
      const ent = CASHIN_ENTITY[r.company] ?? r.company;
      const ch = CASHIN_CHANNEL[r.channel] ?? r.channel;
      const detail =
        severity === "warn"
          ? `${ent} ${ch}: ${rm(r.revenue)} rung, ${rm(r.banked)} banked — ${rm(r.gap)} (${r.gapPct}%) short of the ~${r.expectedPct}% fee band`
          : `${ent} ${ch}: banked ${rm(r.banked)} vs ${rm(r.revenue)} rung (${r.gapPct}%) — settlement-timing spill or misclassified credit`;
      return { company: r.company, channel: r.channel, severity, revenue: r.revenue, banked: r.banked, gap: r.gap, gapPct: r.gapPct, detail };
    })
    .sort((a, b) => (a.severity === b.severity ? Math.abs(b.gap) - Math.abs(a.gap) : a.severity === "warn" ? -1 : 1));
}

async function logFindings(from: string, to: string, findings: CashInFinding[]): Promise<number> {
  if (!findings.length) return 0;
  const client = getFinanceClient();
  const rows = findings.map((f) => ({
    id: randomUUID(),
    agent: "cash-in-recon",
    agent_version: CASH_IN_AGENT_VERSION,
    input: { from, to, company: f.company, channel: f.channel },
    output: { severity: f.severity, detail: f.detail, revenue: f.revenue, banked: f.banked, gap: f.gap, gapPct: f.gapPct },
    confidence: 1.0,
    applied: false,
    related_type: `cash_in_${f.channel}`,
    related_id: f.company,
  }));
  const { error } = await client.from("fin_agent_decisions").insert(rows);
  if (error) throw new Error(`cash-in-recon log failed: ${error.message}`);
  return rows.length;
}

export async function runCashInReconAgent(from: string, to: string): Promise<{ findings: CashInFinding[]; logged: number; totals: { revenue: number; banked: number; gap: number } }> {
  const recon = await cashInReconByChannel(from, to);
  const findings = findingsFromRecon(recon.rows);
  const logged = await logFindings(from, to, findings);
  return { findings, logged, totals: recon.totals };
}

// Run for the settled trailing week and deliver a digest when anything is
// flagged. Best-effort Telegram; never throws to the cron caller.
export async function runAndNotify(): Promise<{ from: string; to: string; flags: number; logged: number; delivered: boolean }> {
  const { from, to } = settledWeekWindow();
  const { findings, logged, totals } = await runCashInReconAgent(from, to);
  let delivered = false;
  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  const chatId = chatRaw ? parseInt(chatRaw, 10) : NaN;
  if (findings.length > 0 && !Number.isNaN(chatId)) {
    try {
      const res = await sendMessage(chatId, formatDigest(from, to, findings, totals));
      delivered = res.ok;
    } catch (e) {
      console.error("[cash-in-recon] telegram send failed", e);
    }
  }
  return { from, to, flags: findings.length, logged, delivered };
}

export function formatDigest(from: string, to: string, findings: CashInFinding[], totals: { revenue: number; banked: number; gap: number }): string {
  if (!findings.length) return `<b>Cash-In Recon</b> ${from}→${to}\nAll channels settled within fee band. ${rm(totals.banked)} banked on ${rm(totals.revenue)} rung.`;
  const icon: Record<CashInFinding["severity"], string> = { warn: "🟠", info: "⚪" };
  const lines: string[] = [
    `<b>Cash-In Recon</b> ${from}→${to} — ${findings.length} to check`,
    `Group: ${rm(totals.revenue)} rung, ${rm(totals.banked)} banked, ${rm(totals.gap)} gap.`,
    "",
  ];
  for (const f of findings) lines.push(`${icon[f.severity]} ${f.detail}`);
  lines.push(`\nDetail: backoffice.celsiuscoffee.com/finance/reports (Reconciliation)`);
  return lines.join("\n");
}
