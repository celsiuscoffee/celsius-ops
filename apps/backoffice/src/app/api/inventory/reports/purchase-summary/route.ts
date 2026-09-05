import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { parseMytRangeParam } from "@/lib/inventory/myt-date";

/**
 * GET /api/inventory/reports/purchase-summary
 * Query params: outletId, supplierId, from, to (ISO date strings)
 * Returns purchase summary aggregated by supplier within the date range.
 *
 * A bare YYYY-MM-DD `to` covers the WHOLE MYT day (23:59:59.999 +08:00); a bare
 * `from` starts at MYT midnight. Previously `to=2026-09-01` meant 00:00 UTC and
 * silently dropped everything ordered that day.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const params = new URL(req.url).searchParams;
  const outletId = params.get("outletId") || undefined;
  const supplierId = params.get("supplierId") || undefined;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseMytRangeParam(params.get("from"), "start") ?? defaultFrom;
  const to = parseMytRangeParam(params.get("to"), "end") ?? now;

  // Fetch orders (not DRAFT or CANCELLED) within date range
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(outletId ? { outletId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
      receivings: {
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      },
      invoices: { select: { amount: true } },
    },
  });

  // Fetch outlets and suppliers for filter dropdowns
  const [outlets, suppliers] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.supplier.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
    }),
  ]);

  // Aggregate by supplier
  const supplierMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      totalOrders: number;
      totalOrderedAmount: number;
      totalReceivedAmount: number;
      totalInvoiced: number;
      productMap: Map<
        string,
        {
          productName: string;
          sku: string;
          qtyOrdered: number;
          qtyReceived: number;
          amount: number;
        }
      >;
    }
  >();

  for (const order of orders) {
    const sid = order.supplierId ?? "unknown";
    if (!supplierMap.has(sid)) {
      supplierMap.set(sid, {
        supplierId: sid,
        supplierName: order.supplier?.name ?? "Unknown",
        totalOrders: 0,
        totalOrderedAmount: 0,
        totalReceivedAmount: 0,
        totalInvoiced: 0,
        productMap: new Map(),
      });
    }
    const agg = supplierMap.get(sid)!;
    agg.totalOrders += 1;
    agg.totalOrderedAmount += Number(order.totalAmount);

    // Price lookup keyed by the ORDER LINE (product + package). A product bought
    // in two pack sizes on one PO has two unit prices; a per-product map let the
    // last line win and mispriced the other pack's receipts. Fall back to the
    // product-level price only when the PO has exactly one line for it.
    const linePriceMap = new Map<string, number>();
    const productLinePrices = new Map<string, number[]>();
    for (const item of order.items) {
      const unitPrice = Number(item.unitPrice);
      linePriceMap.set(`${item.productId}_${item.productPackageId ?? ""}`, unitPrice);
      productLinePrices.set(item.productId, [...(productLinePrices.get(item.productId) ?? []), unitPrice]);

      // Accumulate ordered product breakdown
      const pkey = item.productId;
      if (!agg.productMap.has(pkey)) {
        agg.productMap.set(pkey, {
          productName: item.product.name,
          sku: item.product.sku,
          qtyOrdered: 0,
          qtyReceived: 0,
          amount: 0,
        });
      }
      const prod = agg.productMap.get(pkey)!;
      prod.qtyOrdered += Number(item.quantity);
      prod.amount += Number(item.totalPrice);
    }

    // Receiving items: receivedQty * unitPrice from the MATCHING order line
    const priceForReceipt = (productId: string, productPackageId: string | null): number => {
      const exact = linePriceMap.get(`${productId}_${productPackageId ?? ""}`);
      if (exact !== undefined) return exact;
      const candidates = productLinePrices.get(productId) ?? [];
      return candidates.length === 1 ? candidates[0] : 0;
    };
    for (const receiving of order.receivings) {
      for (const ri of receiving.items) {
        const receivedQty = Number(ri.receivedQty);
        const unitPrice = priceForReceipt(ri.productId, ri.productPackageId);
        agg.totalReceivedAmount += receivedQty * unitPrice;

        // Accumulate received qty into product breakdown
        const pkey = ri.productId;
        if (!agg.productMap.has(pkey)) {
          agg.productMap.set(pkey, {
            productName: ri.product.name,
            sku: ri.product.sku,
            qtyOrdered: 0,
            qtyReceived: 0,
            amount: 0,
          });
        }
        agg.productMap.get(pkey)!.qtyReceived += receivedQty;
      }
    }

    // Invoices
    for (const inv of order.invoices) {
      agg.totalInvoiced += Number(inv.amount);
    }
  }

  // Round helper
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Build items array
  const items = Array.from(supplierMap.values())
    .map((agg) => {
      const productBreakdown = Array.from(agg.productMap.values()).map((p) => ({
        productName: p.productName,
        sku: p.sku,
        qtyOrdered: r2(p.qtyOrdered),
        qtyReceived: r2(p.qtyReceived),
        amount: r2(p.amount),
      }));
      // Sort products by amount descending
      productBreakdown.sort((a, b) => b.amount - a.amount);

      const topProducts = productBreakdown.slice(0, 3).map((p) => p.productName);

      return {
        supplierId: agg.supplierId,
        supplierName: agg.supplierName,
        totalOrders: agg.totalOrders,
        totalAmount: r2(agg.totalOrderedAmount),
        totalReceived: r2(agg.totalReceivedAmount),
        totalInvoiced: r2(agg.totalInvoiced),
        productCount: productBreakdown.length,
        topProducts,
        productBreakdown,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // Summary
  const totalSpend = items.reduce((s, i) => s + i.totalAmount, 0);
  const totalOrders = items.reduce((s, i) => s + i.totalOrders, 0);
  const totalSuppliers = items.length;
  const avgOrderValue = totalOrders > 0 ? totalSpend / totalOrders : 0;

  return NextResponse.json({
    summary: {
      totalSpend: r2(totalSpend),
      totalOrders,
      totalSuppliers,
      avgOrderValue: r2(avgOrderValue),
    },
    outlets,
    suppliers,
    items,
  });
}
