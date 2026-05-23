import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/inventory?outletId=<id>
 *
 * Read-only stock levels for an outlet. Staff app uses this to surface
 * what's on hand without giving staff the BackOffice par-level/edit
 * surface. Sums quantity across all packages per product.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const requestedOutletId = searchParams.get("outletId");
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const outletId = isAdmin ? (requestedOutletId || session.outletId) : session.outletId;

  if (!outletId) {
    return NextResponse.json({ error: "No outlet on session" }, { status: 400 });
  }

  const [balances, parLevels, products] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { outletId },
      select: {
        productId: true,
        quantity: true,
      },
    }),
    prisma.parLevel.findMany({
      where: { outletId },
      select: { productId: true, parLevel: true, reorderPoint: true },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        baseUom: true,
        storageArea: true,
        group: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const balanceMap = new Map<string, number>();
  for (const b of balances) {
    balanceMap.set(b.productId, (balanceMap.get(b.productId) ?? 0) + Number(b.quantity));
  }
  const parMap = new Map(
    parLevels.map((p) => [
      p.productId,
      {
        parLevel: Number(p.parLevel),
        reorderPoint: Number(p.reorderPoint),
      },
    ]),
  );

  const items = products.map((p) => {
    const qty = balanceMap.get(p.id) ?? 0;
    const par = parMap.get(p.id);
    let status: "critical" | "low" | "ok" | "no_par" = "no_par";
    if (par) {
      if (qty <= 0) status = "critical";
      else if (qty <= par.reorderPoint) status = "low";
      else status = "ok";
    }
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      baseUom: p.baseUom,
      storageArea: p.storageArea || "UNCATEGORIZED",
      category: p.group.name,
      quantity: qty,
      parLevel: par?.parLevel ?? null,
      reorderPoint: par?.reorderPoint ?? null,
      status,
    };
  });

  return NextResponse.json({ items });
}
