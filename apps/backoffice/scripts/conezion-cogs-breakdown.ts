// Read-only: conezion Q2 2026 COGS by menu category (consumption basis) to see
// what drives the 39% food cost.
//   cd apps/backoffice && set -a && . ./.env.local && set +a
//   npx tsx scripts/conezion-cogs-breakdown.ts

import { getFinanceClient } from "../src/lib/finance/supabase";
import { buildByCategory, type OutletPick } from "../src/app/api/sales/_lib/reports";
import { prisma } from "../src/lib/prisma";

const COMPANY = "celsiusconezion";
const START = "2026-04-01";
const END = "2026-06-30";

async function main() {
  const client = getFinanceClient();
  const { data: oc } = await client.from("fin_outlet_companies").select("outlet_id").eq("company_id", COMPANY);
  const ids = (oc ?? []).map((r) => r.outlet_id as string);
  const outlets = (await prisma.outlet.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  })) as OutletPick[];

  const res = await buildByCategory(outlets, START, END);
  const rows = (res.rows as Array<Record<string, number | string>>) ?? [];
  const t = res.total as Record<string, number | string>;

  console.log(`conezion Q2 (${START}..${END}) COGS by category (recipe cost, packaging excl.)\n`);
  console.log("category                netSales      COGS   COGS%   %ofSales   GP%");
  for (const r of rows) {
    console.log(
      `${String(r.category).slice(0, 22).padEnd(22)} ${Number(r.netSales).toFixed(0).padStart(9)} ${Number(r.cogs).toFixed(0).padStart(9)} ${Number(r.cogsPct).toFixed(1).padStart(6)}% ${Number(r.sharePct).toFixed(1).padStart(8)}% ${Number(r.gpPct).toFixed(1).padStart(6)}%`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(22)} ${Number(t.netSales).toFixed(0).padStart(9)} ${Number(t.cogs).toFixed(0).padStart(9)} ${Number(t.cogsPct).toFixed(1).padStart(6)}%`,
  );

  // Flag categories that read cost 0 (no recipe) — they understate COGS.
  const zero = rows.filter((r) => Number(r.cogs) === 0 && Number(r.netSales) > 0);
  if (zero.length) {
    console.log(`\n⚠ categories with RM0 recipe cost (no BOM — understating COGS): ${zero.map((r) => `${r.category} (RM${Number(r.netSales).toFixed(0)} sales)`).join(", ")}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
