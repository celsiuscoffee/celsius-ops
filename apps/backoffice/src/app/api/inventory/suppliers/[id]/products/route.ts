import { NextResponse, NextRequest } from "next/server";
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { recordPriceChange } from "@/lib/inventory/price-history";
import { boundedReorderQty } from "@/lib/inventory/order-validation";

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

/**
 * GET /api/inventory/suppliers/[id]/products?outletId=…
 * The supplier's active price-list products — for building a PO from the workspace.
 *
 * With `outletId`, each row also carries `suggestedQty` (package units): the
 * below-par shortfall for that outlet run through boundedReorderQty (MOQ floor,
 * max-level + shelf-life ceilings — the same engine as the exec/reorder
 * suggestions), 0 when the item is fine or already covered by an open PO. The
 * composer shows it as a tap-to-apply assist so the buyer isn't guessing amounts.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id: supplierId } = await params;
  const outletId = req.nextUrl.searchParams.get("outletId");

  const rows = await prisma.supplierProduct.findMany({
    where: { supplierId, isActive: true, price: { gt: 0 }, product: { isActive: true } },
    select: {
      id: true,
      price: true,
      moq: true,
      productPackageId: true,
      product: { select: { id: true, name: true, shelfLifeDays: true } },
      productPackage: { select: { packageLabel: true, conversionFactor: true } },
    },
    orderBy: { product: { name: "asc" } },
  });

  // Per-outlet reorder suggestion per product (base need → this supplier's package units).
  const suggested = new Map<string, number>();
  if (outletId && rows.length) {
    const productIds = rows.map((r) => r.product.id);
    const [pars, stocks, openLines] = await Promise.all([
      prisma.parLevel.findMany({
        where: { outletId, productId: { in: productIds } },
        select: { productId: true, parLevel: true, reorderPoint: true, maxLevel: true, avgDailyUsage: true },
      }),
      prisma.stockBalance.findMany({
        where: { outletId, productId: { in: productIds } },
        select: { productId: true, quantity: true },
      }),
      prisma.orderItem.findMany({
        where: {
          productId: { in: productIds },
          order: { outletId, orderType: "PURCHASE_ORDER", status: { in: OPEN_ORDER_STATUSES } },
        },
        select: { productId: true },
      }),
    ]);
    const stockMap = new Map<string, number>();
    for (const s of stocks) stockMap.set(s.productId, (stockMap.get(s.productId) ?? 0) + Number(s.quantity));
    const covered = new Set(openLines.map((l) => l.productId));
    const parMap = new Map(pars.map((p) => [p.productId, p]));

    for (const r of rows) {
      const par = parMap.get(r.product.id);
      if (!par || covered.has(r.product.id)) continue;
      const stock = stockMap.get(r.product.id) ?? 0;
      if (stock > Number(par.reorderPoint)) continue;
      const needed = Math.max(Number(par.parLevel) - stock, 0);
      if (needed <= 0) continue;
      const convRaw = r.productPackage ? Number(r.productPackage.conversionFactor) : 1;
      const avgDaily = par.avgDailyUsage != null ? Number(par.avgDailyUsage) : 0;
      const { orderQty } = boundedReorderQty({
        neededBase: needed,
        conversionFactor: convRaw > 0 ? convRaw : 1,
        moq: Number(r.moq) || 0,
        headroomBase: par.maxLevel != null ? Math.max(Number(par.maxLevel) - stock, 0) : null,
        shelfUsableBase:
          r.product.shelfLifeDays && avgDaily > 0 ? r.product.shelfLifeDays * avgDaily : null,
      });
      // Keyed per supplier-product ROW, not per product: the qty is in THIS
      // row's package units, and a product listed in two pack sizes (1kg bag +
      // 5kg carton) got the same number shown on both rows — tapping the other
      // pack over/under-ordered by the conversion ratio.
      if (orderQty > 0) suggested.set(r.id, orderQty);
    }
  }

  return NextResponse.json(
    rows.map((r) => ({
      supplierProductId: r.id,
      productId: r.product.id,
      name: r.product.name,
      packageLabel: r.productPackage?.packageLabel ?? "unit",
      productPackageId: r.productPackageId,
      price: Number(r.price),
      moq: Number(r.moq) || 0,
      suggestedQty: suggested.get(r.id) ?? 0,
    })),
  );
}

/**
 * POST /api/suppliers/[id]/products
 * Add a product to a supplier's price list.
 * Body: { productId, productPackageId?, price }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id: supplierId } = await params;
  const body = await req.json();
  const { productId, productPackageId, price } = body;

  if (!productId || price === undefined) {
    return NextResponse.json({ error: "productId and price are required" }, { status: 400 });
  }

  // Find existing or create — can't use upsert with nullable composite key
  const existing = await prisma.supplierProduct.findFirst({
    where: {
      supplierId,
      productId,
      productPackageId: productPackageId || null,
    },
  });

  if (existing) {
    await recordPriceChange({
      supplierId,
      productId,
      productPackageId: productPackageId || null,
      oldPrice: Number(existing.price),
      newPrice: Number(price),
    });
  }

  const sp = existing
    ? await prisma.supplierProduct.update({
        where: { id: existing.id },
        data: { price },
        include: {
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true } },
        },
      })
    : await prisma.supplierProduct.create({
        data: {
          supplierId,
          productId,
          productPackageId: productPackageId || null,
          price,
        },
        include: {
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true } },
        },
      });

  return NextResponse.json({
    id: sp.id,
    productId: sp.productId,
    name: sp.product.name,
    sku: sp.product.sku,
    price: Number(sp.price),
    uom: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
  }, { status: 201 });
}

/**
 * DELETE /api/suppliers/[id]/products
 * Remove a product from supplier's price list.
 * Body: { supplierProductId }
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { supplierProductId } = body;

  if (!supplierProductId) {
    return NextResponse.json({ error: "supplierProductId is required" }, { status: 400 });
  }

  await prisma.supplierProduct.delete({ where: { id: supplierProductId } });
  return NextResponse.json({ ok: true });
}
