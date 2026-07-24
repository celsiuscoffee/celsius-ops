// Read-only: Q2 2026 COGS per entity, purchases-basis (GL) vs consumption-basis
// (BOM, what the sourced P&L computes), to decide where to land Q2 COGS.
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/q2-cogs-basis.ts

import { buildSourcedPnl } from "../src/lib/finance/reports/pnl-sourced";

const ENTITIES = ["celsius", "celsiusconezion", "celsiustamarind"];
const START = "2026-04-01";
const END = "2026-06-30";

async function main() {
  console.log(`Q2 2026 (${START}..${END})\n`);
  console.log("entity              revenue      COGS(consumption)   COGS%   basis");
  let tRev = 0, tCogs = 0;
  for (const companyId of ENTITIES) {
    const p = await buildSourcedPnl({ companyId, start: START, end: END });
    const rev = p.income.total;
    const cogs = p.cogs.total;
    const basis = p.cogs.lines.map((l) => l.code).join("+") || "none";
    tRev += rev; tCogs += cogs;
    console.log(
      `${companyId.padEnd(18)} ${rev.toFixed(2).padStart(11)} ${cogs.toFixed(2).padStart(18)} ${(rev ? (cogs / rev) * 100 : 0).toFixed(1).padStart(6)}%   ${basis}`,
    );
  }
  console.log(`${"GROUP".padEnd(18)} ${tRev.toFixed(2).padStart(11)} ${tCogs.toFixed(2).padStart(18)} ${(tRev ? (tCogs / tRev) * 100 : 0).toFixed(1).padStart(6)}%`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
