import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

// GET only. This route used to also expose a POST that created a count AND wrote
// StockBalance from `countedQty` WITHOUT converting package units to base UOM
// (the staff finalize route converts). Nothing called it — the backoffice
// stock-count page only lists here and PATCHes /stock-checks/[id]; staff-native
// and the staff web app go through apps/staff's /api/stock-checks — so the
// handler was removed (2026-09-05) rather than fixed. Counts are created by
// staff; this console reviews them.
export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stockCounts = await prisma.stockCount.findMany({
    select: {
      id: true,
      frequency: true,
      status: true,
      notes: true,
      countDate: true,
      submittedAt: true,
      reviewedAt: true,
      createdAt: true,
      outlet: { select: { name: true, code: true } },
      countedBy: { select: { name: true } },
      items: {
        select: {
          id: true,
          expectedQty: true,
          countedQty: true,
          isConfirmed: true,
          varianceReason: true,
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true, conversionFactor: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = stockCounts.map((sc) => ({
    id: sc.id,
    outlet: sc.outlet.name,
    outletCode: sc.outlet.code,
    frequency: sc.frequency,
    countedBy: sc.countedBy.name,
    countDate: sc.countDate.toISOString(),
    status: sc.status,
    notes: sc.notes,
    submittedAt: sc.submittedAt?.toISOString() ?? null,
    reviewedAt: sc.reviewedAt?.toISOString() ?? null,
    createdAt: sc.createdAt.toISOString(),
    items: sc.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      baseUom: i.product.baseUom,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      packageConversion: i.productPackage?.conversionFactor ? Number(i.productPackage.conversionFactor) : 0,
      expectedQty: i.expectedQty ? Number(i.expectedQty) : null,
      countedQty: i.countedQty ? Number(i.countedQty) : null,
      isConfirmed: i.isConfirmed,
      varianceReason: i.varianceReason,
    })),
  }));

  return NextResponse.json(mapped);
}
