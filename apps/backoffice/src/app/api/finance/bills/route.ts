// GET /api/finance/bills
// Lists supplier bills from the LIVE Invoice table (fin_bills was never
// populated and is tombstoned — migration 097). Supports filters by status +
// supplier. Company scoping goes through the outlet→company mapping. Used on
// a future /finance/bills page (or a drawer in /finance/inbox showing active
// payables).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { InvoiceStatus } from "@prisma/client";
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
  const status = url.searchParams.get("status");
  const supplierId = url.searchParams.get("supplierId");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  const client = getFinanceClient();
  const { data: mappings } = await client
    .from("fin_outlet_companies")
    .select("outlet_id")
    .eq("company_id", companyId);
  const outletIds = (mappings ?? []).map((m) => m.outlet_id as string);
  if (outletIds.length === 0) return NextResponse.json({ bills: [] });

  const invoices = await prisma.invoice.findMany({
    where: {
      outletId: { in: outletIds },
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status: status as InvoiceStatus } : {}),
    },
    orderBy: { issueDate: "desc" },
    take: limit,
    select: {
      id: true,
      supplierId: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      outletId: true,
      amount: true,
      status: true,
      paymentType: true,
      expenseCategory: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    bills: invoices.map((b) => ({
      id: b.id,
      supplier_id: b.supplierId,
      bill_number: b.invoiceNumber,
      bill_date: b.issueDate.toISOString().slice(0, 10),
      due_date: b.dueDate ? b.dueDate.toISOString().slice(0, 10) : null,
      outlet_id: b.outletId,
      // Invoice.amount is the FULL invoice total even when PARTIALLY_PAID
      // (warehouse contract); there is no per-bill paid_amount column.
      total: Number(b.amount),
      payment_status: b.status,
      payment_type: b.paymentType,
      expense_category: b.expenseCategory,
      supplier: b.supplier,
    })),
  });
}
