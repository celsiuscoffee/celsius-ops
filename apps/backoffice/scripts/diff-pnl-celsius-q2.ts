// Diagnostic (read-only): decompose the GL-vs-sourced expense gap for celsius
// May & June 2026. Prints, per month: the sourced P&L (income/COGS/expense
// lines) and the GL P&L (posted fin_journal_lines by account), so the
// divergence can be attributed to a driver rather than guessed at.
//
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/diff-pnl-celsius-q2.ts

import { buildSourcedPnl } from "../src/lib/finance/reports/pnl-sourced";
import { getFinanceClient } from "../src/lib/finance/supabase";

const COMPANY = "celsius";
const MONTHS = [
  { period: "2026-05", start: "2026-05-01", end: "2026-05-31" },
  { period: "2026-06", start: "2026-06-01", end: "2026-06-30" },
];
const r2 = (n: number) => Math.round(n * 100) / 100;

async function glPnl(client: ReturnType<typeof getFinanceClient>, start: string, end: string) {
  const { data: accounts } = await client.from("fin_accounts").select("code, type, name");
  const type = new Map((accounts ?? []).map((a) => [a.code as string, a.type as string]));
  const name = new Map((accounts ?? []).map((a) => [a.code as string, a.name as string]));

  // posted txns for the company in the window, paged
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await client
      .from("fin_transactions")
      .select("id")
      .eq("company_id", COMPANY)
      .eq("status", "posted")
      .gte("txn_date", start)
      .lte("txn_date", end)
      .order("id")
      .range(from, from + 999);
    const rows = data ?? [];
    ids.push(...rows.map((t) => t.id as string));
    if (rows.length < 1000) break;
  }
  const byCode = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit")
      .in("transaction_id", ids.slice(i, i + 150));
    for (const l of lines ?? []) {
      const code = l.account_code as string;
      const t = type.get(code);
      if (!t) continue;
      const sign = t === "income" ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      byCode.set(code, r2((byCode.get(code) ?? 0) + sign));
    }
  }
  const section = (kind: string) =>
    [...byCode.entries()]
      .filter(([c]) => type.get(c) === kind)
      .filter(([, v]) => Math.abs(v) > 0.005)
      .sort((a, b) => b[1] - a[1]);
  const sum = (kind: string) => r2(section(kind).reduce((s, [, v]) => s + v, 0));
  return { section, sum, name };
}

async function main() {
  const client = getFinanceClient();
  for (const m of MONTHS) {
    const src = await buildSourcedPnl({ companyId: COMPANY, start: m.start, end: m.end });
    const gl = await glPnl(client, m.start, m.end);

    console.log(`\n════════ celsius ${m.period} ════════`);
    console.log(`               SOURCED        GL          diff(GL-src)`);
    const row = (label: string, s: number, g: number) =>
      console.log(`${label.padEnd(14)} ${s.toFixed(2).padStart(12)} ${g.toFixed(2).padStart(12)} ${(g - s).toFixed(2).padStart(12)}`);
    row("Income", src.income.total, gl.sum("income"));
    row("COGS", src.cogs.total, gl.sum("cogs"));
    row("Expenses", src.expenses.total, gl.sum("expense"));
    row("NetIncome", src.netIncome, r2(gl.sum("income") - gl.sum("cogs") - gl.sum("expense")));

    console.log(`\n  — sourced EXPENSE lines —`);
    for (const l of src.expenses.lines) console.log(`    ${l.code.padEnd(22)} ${l.name.slice(0, 40).padEnd(42)} ${l.amount.toFixed(2).padStart(11)}`);
    console.log(`  — GL EXPENSE accounts (6xxx) —`);
    for (const [c, v] of gl.section("expense")) console.log(`    ${c.padEnd(10)} ${(gl.name.get(c) ?? "").slice(0, 40).padEnd(42)} ${v.toFixed(2).padStart(11)}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
