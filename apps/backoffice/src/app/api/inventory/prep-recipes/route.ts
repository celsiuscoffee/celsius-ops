import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * Prep recipes — the central-kitchen sub-BOM (raw inputs → prepped output).
 *
 * Central Preparation (supplier CK0001) turns raw stock into prepped products
 * that outlet menus consume: 10kg raw "Chicken Chop" → 10 pcs "Grilled
 * Chicken". Its price list values the prepped item, but nothing described the
 * conversion, so raw stock never depleted in theory and the transfer price was
 * never checked against real raw cost.
 *
 * The GET here does that check: it computes cost-per-prepped-unit from the
 * recipe and compares it to the Central Preparation list price, so a drifting
 * or mis-keyed transfer price is visible on the page.
 */

const CENTRAL_PREP_CODE = "CK0001";

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cheapest cost per BASE unit per product (cheapest non-ADHOC, non-zero
 * supplier price ÷ package conversion) — the same basis the menu BOM costing
 * uses, so prep costs and menu costs stay comparable.
 */
async function buildCostMap(): Promise<Map<string, number>> {
  const sps = await prisma.supplierProduct.findMany({
    where: { isActive: true },
    select: {
      productId: true,
      price: true,
      productPackage: { select: { conversionFactor: true } },
      supplier: { select: { supplierCode: true } },
    },
  });
  const map = new Map<string, number>();
  for (const sp of sps) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (price <= 0) continue;
    const conv = sp.productPackage?.conversionFactor ? Number(sp.productPackage.conversionFactor) : 0;
    if (conv <= 0) continue;
    const perBase = price / conv;
    const existing = map.get(sp.productId);
    if (!existing || perBase < existing) map.set(sp.productId, perBase);
  }
  return map;
}

/** Central Preparation's own list price per BASE unit, per prepped product. */
async function buildTransferPriceMap(): Promise<Map<string, number>> {
  const sps = await prisma.supplierProduct.findMany({
    where: { isActive: true, supplier: { supplierCode: CENTRAL_PREP_CODE } },
    select: { productId: true, price: true, productPackage: { select: { conversionFactor: true } } },
  });
  const map = new Map<string, number>();
  for (const sp of sps) {
    const price = Number(sp.price);
    const conv = sp.productPackage?.conversionFactor ? Number(sp.productPackage.conversionFactor) : 0;
    if (price <= 0 || conv <= 0) continue;
    map.set(sp.productId, price / conv);
  }
  return map;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const [recipes, costMap, transferMap] = await Promise.all([
    prisma.productRecipe.findMany({
      include: {
        outputProduct: { select: { id: true, name: true, sku: true, baseUom: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, baseUom: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    buildCostMap(),
    buildTransferPriceMap(),
  ]);

  const mapped = recipes.map((r) => {
    const items = r.items.map((it) => {
      const unitCost = costMap.get(it.productId) ?? 0;
      const qty = Number(it.quantityUsed);
      return {
        id: it.id,
        productId: it.productId,
        productName: it.product.name,
        productSku: it.product.sku,
        baseUom: it.product.baseUom,
        quantityUsed: qty,
        uom: it.uom,
        unitCost: round4(unitCost),
        lineCost: round2(qty * unitCost),
        // A raw input with no supplier price can't be costed — the batch total
        // is understated until someone prices it, so the UI flags it.
        costMissing: !costMap.has(it.productId),
      };
    });

    const batchCost = items.reduce((s, i) => s + i.lineCost, 0);
    const yieldQty = Number(r.yieldQuantity);
    const costPerUnit = yieldQty > 0 ? batchCost / yieldQty : 0;
    const transferPrice = transferMap.get(r.outputProductId) ?? null;
    // Positive variance = Central Prep's list price is ABOVE computed raw cost
    // (stock valued rich); negative = below (valued lean).
    const variance = transferPrice != null ? costPerUnit - transferPrice : null;

    return {
      id: r.id,
      outputProductId: r.outputProductId,
      outputProductName: r.outputProduct.name,
      outputProductSku: r.outputProduct.sku,
      outputBaseUom: r.outputProduct.baseUom,
      yieldQuantity: yieldQty,
      yieldUom: r.yieldUom,
      prepNote: r.prepNote,
      isActive: r.isActive,
      items,
      batchCost: round2(batchCost),
      costPerUnit: round4(costPerUnit),
      transferPrice: transferPrice != null ? round4(transferPrice) : null,
      variance: variance != null ? round4(variance) : null,
      variancePct: transferPrice ? round2(((costPerUnit - transferPrice) / transferPrice) * 100) : null,
      anyCostMissing: items.some((i) => i.costMissing),
    };
  });

  return NextResponse.json(mapped);
}

type IncomingItem = { productId?: unknown; quantityUsed?: unknown; uom?: unknown };

/** Shared validation for create/replace. Returns clean lines or an error string. */
export function normaliseItems(
  raw: unknown,
): { ok: true; items: { productId: string; quantityUsed: number; uom: string }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "At least one input line is required" };
  const seen = new Set<string>();
  const items: { productId: string; quantityUsed: number; uom: string }[] = [];
  for (const r of raw as IncomingItem[]) {
    const productId = typeof r.productId === "string" ? r.productId : "";
    if (!productId) return { ok: false, error: "Each input line needs a product" };
    // The DB has a unique (recipeId, productId); catching it here gives a clear
    // message instead of a P2002 surfacing as a 500.
    if (seen.has(productId)) return { ok: false, error: "The same input product appears twice" };
    seen.add(productId);
    const quantityUsed = Number(r.quantityUsed);
    if (!Number.isFinite(quantityUsed) || quantityUsed <= 0) {
      return { ok: false, error: "Each input line needs a quantity greater than zero" };
    }
    items.push({ productId, quantityUsed, uom: typeof r.uom === "string" && r.uom ? r.uom : "" });
  }
  return { ok: true, items };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const outputProductId = typeof body.outputProductId === "string" ? body.outputProductId : "";
  if (!outputProductId) return NextResponse.json({ error: "outputProductId is required" }, { status: 400 });

  const yieldQuantity = Number(body.yieldQuantity);
  // Cost-per-unit divides by yield, so zero/negative would be a divide-by-zero.
  if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0) {
    return NextResponse.json({ error: "Yield quantity must be greater than zero" }, { status: 400 });
  }

  const parsed = normaliseItems(body.items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // A prepped product cannot be an input to its own recipe.
  if (parsed.items.some((i) => i.productId === outputProductId)) {
    return NextResponse.json({ error: "A recipe cannot consume its own output product" }, { status: 400 });
  }

  const existing = await prisma.productRecipe.findUnique({ where: { outputProductId }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "That product already has a prep recipe — edit it instead." }, { status: 409 });
  }

  const output = await prisma.product.findUnique({ where: { id: outputProductId }, select: { baseUom: true } });
  if (!output) return NextResponse.json({ error: "Output product not found" }, { status: 404 });

  const recipe = await prisma.productRecipe.create({
    data: {
      outputProductId,
      yieldQuantity,
      yieldUom: typeof body.yieldUom === "string" && body.yieldUom ? body.yieldUom : output.baseUom,
      prepNote: typeof body.prepNote === "string" && body.prepNote ? body.prepNote : null,
      isActive: body.isActive ?? true,
      items: { create: parsed.items },
    },
    select: { id: true },
  });

  return NextResponse.json(recipe, { status: 201 });
}
