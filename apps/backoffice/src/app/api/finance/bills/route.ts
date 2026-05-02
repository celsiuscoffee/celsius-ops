// GET /api/finance/bills
// Lists fin_bills joined with supplier name. Supports filters by status +
// supplier + date range. Used on a future /finance/bills page (or a
// drawer in /finance/inbox showing active payables).

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
  const paymentStatus = url.searchParams.get("paymentStatus");
  const supplierId = url.searchParams.get("supplierId");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const client = getFinanceClient();
  let q = client
    .from("fin_bills")
    .select(
      "id, company_id, supplier_id, bill_number, bill_date, due_date, outlet_id, subtotal, sst_amount, total, payment_status, paid_amount, transaction_id, created_at"
    )
    .eq("company_id", companyId)
    .order("bill_date", { ascending: false })
    .limit(limit);
  if (paymentStatus) q = q.eq("payment_status", paymentStatus);
  if (supplierId) q = q.eq("supplier_id", supplierId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const supplierIds = Array.from(new Set((data ?? []).map((r) => r.supplier_id).filter(Boolean))) as string[];
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, name: true },
      })
    : [];
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  return NextResponse.json({
    bills: (data ?? []).map((b) => ({
      ...b,
      supplier: b.supplier_id ? supplierMap.get(b.supplier_id as string) ?? null : null,
    })),
  });
}
