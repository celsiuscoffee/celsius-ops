import { buildSourcedPnl } from "../src/lib/finance/reports/pnl-sourced";

async function main() {
  const p = await buildSourcedPnl({ companyId: "celsiusconezion", start: "2026-04-01", end: "2026-06-30" });
  console.log("INCOME");
  for (const l of p.income.lines) console.log(`  ${l.code.padEnd(22)} ${l.name.slice(0,40).padEnd(42)} ${l.amount.toFixed(2).padStart(12)}`);
  console.log(`  Total income ${p.income.total.toFixed(2).padStart(12)}`);
  console.log("COGS");
  for (const l of p.cogs.lines) console.log(`  ${l.code.padEnd(22)} ${l.name.slice(0,40).padEnd(42)} ${l.amount.toFixed(2).padStart(12)}`);
  console.log(`  Total COGS ${p.cogs.total.toFixed(2).padStart(12)}`);
  console.log("EXPENSES");
  for (const l of p.expenses.lines) console.log(`  ${l.code.padEnd(22)} ${l.name.slice(0,40).padEnd(42)} ${l.amount.toFixed(2).padStart(12)}`);
  console.log(`  Total expenses ${p.expenses.total.toFixed(2).padStart(12)}`);
  console.log(`NET INCOME ${p.netIncome.toFixed(2).padStart(12)}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
