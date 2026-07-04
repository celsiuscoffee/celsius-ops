// GET /api/finance/fixed-assets/capitalizable: classified EQUIPMENTS bank
// outflows not yet linked to a fixed asset, so the register UI can offer
// one-click capitalization. EQUIPMENTS lines are already EXCLUDED from the
// sourced P&L (BANK_NONOPEX in pnl-sourced.ts), so capitalizing one never
// moves the P&L; it only starts the asset depreciating.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { companyFromAccountName } from "@/lib/finance/gl-posting-map";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getFinanceClient();
  const [{ data: linked }, lines] = await Promise.all([
    client.from("fin_fixed_assets").select("source_bank_line_id").not("source_bank_line_id", "is", null),
    prisma.bankStatementLine.findMany({
      where: { direction: "DR", category: "EQUIPMENTS" },
      select: {
        id: true, txnDate: true, description: true, amount: true, outletId: true,
        outlet: { select: { name: true } },
        statement: { select: { accountName: true } },
      },
      orderBy: { txnDate: "desc" },
      take: 300,
    }),
  ]);
  const linkedIds = new Set((linked ?? []).map((r) => r.source_bank_line_id as string));

  return NextResponse.json({
    lines: lines
      .filter((l) => !linkedIds.has(l.id))
      .map((l) => ({
        id: l.id,
        date: l.txnDate.toISOString().slice(0, 10),
        description: l.description,
        amount: Math.round(Number(l.amount) * 100) / 100,
        companyId: companyFromAccountName(l.statement.accountName),
        outletId: l.outletId,
        outletName: l.outlet?.name ?? null,
      })),
  });
}
