import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/inventory/reports/purchase-summary
 * Query params: outletId, supplierId, from, to (ISO date strings)
 * Returns purchase summary aggregated by supplier within the date range.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const outletId = params.get("outletId") || undefined;
  const supplierId = params.get("supplierId") || undefined;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = params.get("from") ? new Date(params.get("from")!) : defaultFrom;
  const to = params.get("to") ? new Date(params.get("to")!) : now;

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
    const sid = order.supplierId;
    if (!supplierMap.has(sid)) {
      supplierMap.set(sid, {
        supplierId: sid,
        supplierName: order.supplier.name,
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

    // Build a lookup from productId to unitPrice from order items
    const unitPriceMap = new Map<string, number>();
    for (const item of order.items) {
      unitPriceMap.set(item.productId, Number(item.unitPrice));

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

    // Receiving items: receivedQty * unitPrice from corresponding orderItem
    for (const receiving of order.receivings) {
      for (const ri of receiving.items) {
        const receivedQty = Number(ri.receivedQty);
        const unitPrice = unitPriceMap.get(ri.productId) ?? 0;
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
