// GET /api/finance/transactions
// Lists posted journals from fin_transactions, joined with outlet name and
// summary line counts. Filters: outlet, account_code, status, date range.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const client = getFinanceClient();
  let q = client
    .from("fin_transactions")
    .select(
      "id, txn_date, description, outlet_id, amount, currency, txn_type, posted_by_agent, agent_version, confidence, status, posted_at, period, source_doc_id, company_id"
    )
    .eq("company_id", companyId)
    .order("txn_date", { ascending: false })
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (outletId) q = q.eq("outlet_id", outletId);
  if (status) q = q.eq("status", status);
  if (from) q = q.gte("txn_date", from);
  if (to) q = q.lte("txn_date", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate outlet names from Prisma (Supabase JS can't easily join Prisma-managed tables).
  const outletIds = Array.from(new Set((data ?? []).map((r) => r.outlet_id).filter(Boolean))) as string[];
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({
        where: { id: { in: outletIds } },
        select: { id: true, name: true, code: true },
      })
    : [];
  const outletMap = new Map(outlets.map((o) => [o.id, o]));

  return NextResponse.json({
    transactions: (data ?? []).map((r) => ({
      ...r,
      outlet: r.outlet_id ? outletMap.get(r.outlet_id as string) ?? null : null,
    })),
  });
}
