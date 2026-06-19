import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

const SCOPES = ["ALL", "CATEGORY", "ITEMS"] as const;
const CHANNELS = ["ALL", "DINE_IN", "TAKEAWAY", "GRAB", "DELIVERY"] as const;
type Scope = (typeof SCOPES)[number];
type Channel = (typeof CHANNELS)[number];

// Cheapest cost-per-base-unit per product (cheapest non-ADHOC, non-zero
// supplier price ÷ package conversion) — same basis as the menu BOM costing.
async function buildCostMap(): Promise<Map<string, number>> {
  const supplierProducts = await prisma.supplierProduct.findMany({
    where: { isActive: true },
    select: {
      productId: true,
      price: true,
      productPackage: { select: { conversionFactor: true } },
      supplier: { select: { supplierCode: true } },
    },
  });
  const costMap = new Map<string, number>();
  for (const sp of supplierProducts) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (price <= 0) continue;
    const conversion = sp.productPackage?.conversionFactor ? Number(sp.productPackage.conversionFactor) : 0;
    if (conversion <= 0) continue;
    const costPerBase = price / conversion;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) costMap.set(sp.productId, costPerBase);
  }
  return costMap;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const [rules, menus, costMap] = await Promise.all([
    prisma.packagingRule.findMany({
      include: { product: { select: { name: true, sku: true, baseUom: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.menu.findMany({ select: { id: true, category: true } }),
    buildCostMap(),
  ]);

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const mapped = rules.map((r) => {
    // How many menus this rule matches (per-item rules cost into each).
    let matchedMenuCount: number;
    if (r.scope === "CATEGORY") {
      matchedMenuCount = menus.filter((m) => (m.category ?? "") === (r.category ?? "")).length;
    } else if (r.scope === "ITEMS") {
      const set = new Set(r.menuIds);
      matchedMenuCount = menus.filter((m) => set.has(m.id)).length;
    } else {
      matchedMenuCount = menus.length;
    }

    const unitCost = costMap.get(r.productId) ?? 0;
    const lineCost = Number(r.quantity) * unitCost;

    return {
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productSku: r.product.sku,
      baseUom: r.product.baseUom,
      quantity: Number(r.quantity),
      scope: r.scope,
      category: r.category,
      menuIds: r.menuIds,
      channel: r.channel,
      perOrder: r.perOrder,
      isActive: r.isActive,
      notes: r.notes,
      unitCost: round4(unitCost),
      lineCost: round2(lineCost),
      matchedMenuCount,
    };
  });

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { productId, quantity, scope, category, menuIds, channel, perOrder, isActive, notes } = body;

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }
  const scopeVal: Scope = SCOPES.includes(scope) ? scope : "ALL";
  const channelVal: Channel = CHANNELS.includes(channel) ? channel : "ALL";

  const rule = await prisma.packagingRule.create({
    data: {
      productId,
      quantity: quantity != null ? Number(quantity) : 1,
      scope: scopeVal,
      category: scopeVal === "CATEGORY" ? category || null : null,
      menuIds: scopeVal === "ITEMS" && Array.isArray(menuIds) ? menuIds : [],
      channel: channelVal,
      perOrder: !!perOrder,
      isActive: isActive ?? true,
      notes: notes || null,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
