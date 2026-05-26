import { NextResponse, NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs"; // xlsx needs Node

/**
 * GET /api/inventory/reports/purchase-summary/export
 * Same filters as purchase-summary. Returns XLSX with three sheets:
 *   1. Purchase Orders — one row per PO line item (raw)
 *   2. Receivings — one row per receiving line (actual landed qty)
 *   3. Summary by Supplier — same aggregation shown in the UI
 * Excludes DRAFT and CANCELLED orders (matches the main report).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const params = new URL(req.url).searchParams;
  const outletId = params.get("outletId") || undefined;
  const supplierId = params.get("supplierId") || undefined;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = params.get("from") ? new Date(params.get("from")!) : defaultFrom;
  const to = params.get("to") ? new Date(params.get("to")!) : now;

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(outletId ? { outletId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: {
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
      receivings: {
        include: {
          items: { include: { product: { select: { name: true, sku: true } } } },
          receivedBy: { select: { name: true } },
        },
      },
      invoices: {
        select: { invoiceNumber: true, amount: true, status: true, paidAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const n = (v: unknown) => (typeof v === "object" && v !== null && "toNumber" in v ? (v as { toNumber: () => number }).toNumber() : Number(v ?? 0));
  const d = (v: Date | null | undefined) => (v ? v.toISOString().split("T")[0] : "");

  // Sheet 1: Purchase Orders (one row per PO line item)
  type PoRow = Record<string, string | number>;
  const poRows: PoRow[] = [];
  for (const o of orders) {
    const receivedByProduct = new Map<string, number>();
    for (const r of o.receivings) {
      for (const ri of r.items) {
        receivedByProduct.set(ri.productId, (receivedByProduct.get(ri.productId) ?? 0) + n(ri.receivedQty));
      }
    }
    const invoiceNumbers = o.invoices.map((i) => i.invoiceNumber).join(", ");
    const invoiceTotal = o.invoices.reduce((s, i) => s + n(i.amount), 0);

    if (o.items.length === 0) {
      poRows.push({
        "PO Number": o.orderNumber,
        "PO Date": d(o.createdAt),
        "Delivery Date": d(o.deliveryDate),
        Outlet: o.outlet?.name ?? "",
        Supplier: o.supplier?.name ?? "",
        Status: o.status,
        "Expense Category": o.expenseCategory,
        Product: "",
        SKU: "",
        "Qty Ordered": 0,
        "Unit Price (RM)": 0,
        "Line Total (RM)": 0,
        "Qty Received": 0,
        "% Received": 0,
        "Delivery Charge (RM)": n(o.deliveryCharge),
        "PO Total (RM)": n(o.totalAmount),
        "Invoice Numbers": invoiceNumbers,
        "Invoice Total (RM)": invoiceTotal,
        Notes: o.notes ?? "",
      });
      continue;
    }

    for (const it of o.items) {
      const qtyOrdered = n(it.quantity);
      const qtyReceived = receivedByProduct.get(it.productId) ?? 0;
      poRows.push({
        "PO Number": o.orderNumber,
        "PO Date": d(o.createdAt),
        "Delivery Date": d(o.deliveryDate),
        Outlet: o.outlet?.name ?? "",
        Supplier: o.supplier?.name ?? "",
        Status: o.status,
        "Expense Category": o.expenseCategory,
        Product: it.product.name,
        SKU: it.product.sku,
        "Qty Ordered": qtyOrdered,
        "Unit Price (RM)": n(it.unitPrice),
        "Line Total (RM)": n(it.totalPrice),
        "Qty Received": qtyReceived,
        "% Received": qtyOrdered > 0 ? Math.round((qtyReceived / qtyOrdered) * 100) : 0,
        "Delivery Charge (RM)": n(o.deliveryCharge),
        "PO Total (RM)": n(o.totalAmount),
        "Invoice Numbers": invoiceNumbers,
        "Invoice Total (RM)": invoiceTotal,
        Notes: o.notes ?? "",
      });
    }
  }

  // Sheet 2: Receivings (one row per receiving line)
  type RecvRow = Record<string, string | number>;
  const recvRows: RecvRow[] = [];
  for (const o of orders) {
    const unitPriceByProduct = new Map<string, number>();
    for (const it of o.items) unitPriceByProduct.set(it.productId, n(it.unitPrice));

    for (const r of o.receivings) {
      for (const ri of r.items) {
        const unitPrice = unitPriceByProduct.get(ri.productId) ?? 0;
        const receivedQty = n(ri.receivedQty);
        recvRows.push({
          "Receiving Date": d(r.receivedAt),
          "PO Number": o.orderNumber,
          Outlet: o.outlet?.name ?? "",
          Supplier: o.supplier?.name ?? "",
          Product: ri.product.name,
          SKU: ri.product.sku,
          "Qty Ordered": n(ri.orderedQty),
          "Qty Received": receivedQty,
          "Unit Price (RM)": unitPrice,
          "Received Value (RM)": Math.round(receivedQty * unitPrice * 100) / 100,
          "Expiry Date": d(ri.expiryDate),
          Discrepancy: ri.discrepancyReason ?? "",
          "Received By": r.receivedBy?.name ?? "",
          Notes: r.notes ?? "",
        });
      }
    }
  }

  // Sheet 3: Summary by Supplier (mirrors the UI aggregation)
  type SupplierAgg = {
    supplier: string;
    orders: number;
    totalAmount: number;
    receivedAmount: number;
    invoiced: number;
    products: Set<string>;
  };
  const bySupplier = new Map<string, SupplierAgg>();
  for (const o of orders) {
    const key = o.supplier?.name ?? "Unknown";
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplier: key, orders: 0, totalAmount: 0, receivedAmount: 0, invoiced: 0, products: new Set() });
    }
    const agg = bySupplier.get(key)!;
    agg.orders += 1;
    agg.totalAmount += n(o.totalAmount);
    agg.invoiced += o.invoices.reduce((s, i) => s + n(i.amount), 0);
    const unitPriceByProduct = new Map<string, number>();
    for (const it of o.items) {
      unitPriceByProduct.set(it.productId, n(it.unitPrice));
      agg.products.add(it.productId);
    }
    for (const r of o.receivings) {
      for (const ri of r.items) {
        agg.receivedAmount += n(ri.receivedQty) * (unitPriceByProduct.get(ri.productId) ?? 0);
        agg.products.add(ri.productId);
      }
    }
  }
  const summaryRows = Array.from(bySupplier.values())
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .map((s) => ({
      Supplier: s.supplier,
      Orders: s.orders,
      "Total Amount (RM)": Math.round(s.totalAmount * 100) / 100,
      "Received Value (RM)": Math.round(s.receivedAmount * 100) / 100,
      "Invoiced (RM)": Math.round(s.invoiced * 100) / 100,
      "Distinct Products": s.products.size,
    }));

  // Build workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(poRows), "Purchase Orders");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recvRows), "Receivings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary by Supplier");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `purchase-summary_${d(from)}_to_${d(to)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
