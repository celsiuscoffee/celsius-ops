/**
 * GrabFood item-linking admin API (BackOffice side).
 *
 * Grab order webhooks carry Grab's OWN item id (item.id = "MYITE…"), which
 * never matches products.id — so unlinked lines print as "Item @ RM x [MYITE..]"
 * with no kitchen_station. This endpoint manages the grab_item_links mapping
 * the order webhook consults to resolve the real product.
 *
 * GET    /api/integrations/grab/item-links → { products[], links[], unlinked[] }
 * POST   /api/integrations/grab/item-links → { grabItemId, productId } → upsert + backfill
 * DELETE /api/integrations/grab/item-links → { grabItemId } → remove link
 *
 * Raw SQL via Prisma: products / pos_order_items / grab_item_links are POS
 * (Supabase-migration) tables not modelled in the Prisma schema — same pattern
 * as the sibling /api/integrations/grab route.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { Prisma } from "@prisma/client";

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  price_grab: number | null;
  grabfood_price: number | null;
};

type LinkRow = {
  grab_item_id: string;
  product_id: string;
  product_name: string | null;
  label: string | null;
  last_price: number | null;
  updated_at: Date;
};

type UnlinkedRow = {
  grab_item_id: string;
  sample_name: string | null;
  last_price: number | null;
  // Base price (sen) = unit_price − modifier_total. Grab bakes the chosen
  // add-ons into item.price, so the base is what matches a catalogue product.
  base_price: number | null;
  seen: bigint;
  last_seen: Date;
};

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Catalogue for the link dropdown — Grab-visible price first for the hint.
  const products = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT id, name, category, price, price_grab, grabfood_price
    FROM products
    ORDER BY category NULLS LAST, name ASC
  `);

  // Existing links + the product name they resolve to.
  const links = await prisma.$queryRaw<LinkRow[]>(Prisma.sql`
    SELECT g.grab_item_id, g.product_id, p.name AS product_name,
           g.label, g.last_price, g.updated_at
    FROM grab_item_links g
    LEFT JOIN products p ON p.id = g.product_id
    ORDER BY g.updated_at DESC
  `);

  // Distinct Grab item ids seen on recent orders that are neither a known
  // product nor already linked — i.e. the things still showing as "Item".
  const unlinked = await prisma.$queryRaw<UnlinkedRow[]>(Prisma.sql`
    SELECT i.product_id AS grab_item_id,
           MAX(i.product_name) AS sample_name,
           MAX(i.unit_price)   AS last_price,
           MAX(i.unit_price - COALESCE(i.modifier_total, 0)) AS base_price,
           COUNT(*)            AS seen,
           MAX(o.created_at)   AS last_seen
    FROM pos_order_items i
    JOIN pos_orders o ON o.id = i.order_id
    WHERE o.source = 'grabfood'
      AND o.created_at > NOW() - INTERVAL '45 days'
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = i.product_id)
      AND NOT EXISTS (SELECT 1 FROM grab_item_links g WHERE g.grab_item_id = i.product_id)
    GROUP BY i.product_id
    ORDER BY last_seen DESC
    LIMIT 200
  `);

  // Catalogue match: index products by their Grab-facing price (sen). Grab gives
  // us no item name on orders, so price is the only signal — we suggest the
  // catalogue products at the item's base price. Exactly one ⇒ confident
  // pre-fill; several ⇒ a shortlist the staff picks from.
  const productOut = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    priceRM: Number(p.price_grab ?? p.grabfood_price ?? p.price ?? 0),
  }));
  const byPriceSen = new Map<number, typeof productOut>();
  for (const p of productOut) {
    const sen = Math.round(p.priceRM * 100);
    (byPriceSen.get(sen) ?? byPriceSen.set(sen, []).get(sen)!).push(p);
  }

  return NextResponse.json({
    products: productOut,
    links: links.map((l) => ({
      grabItemId: l.grab_item_id,
      productId: l.product_id,
      productName: l.product_name,
      label: l.label,
      lastPriceRM: l.last_price != null ? l.last_price / 100 : null,
      updatedAt: l.updated_at,
    })),
    unlinked: unlinked.map((u) => {
      const baseSen = u.base_price != null ? Number(u.base_price) : null;
      const candidates = baseSen != null ? byPriceSen.get(baseSen) ?? [] : [];
      return {
        grabItemId: u.grab_item_id,
        sampleName: u.sample_name,
        lastPriceRM: u.last_price != null ? Number(u.last_price) / 100 : null,
        basePriceRM: baseSen != null ? baseSen / 100 : null,
        seen: Number(u.seen),
        lastSeen: u.last_seen,
        // Catalogue products at the same base price, and a confident suggestion
        // when there's exactly one.
        candidateIds: candidates.map((c) => c.id),
        suggestedProductId: candidates.length === 1 ? candidates[0].id : null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    grabItemId?: string;
    productId?: string;
    label?: string | null;
    lastPrice?: number | null;
  };
  const grabItemId = (body.grabItemId || "").trim();
  const productId = (body.productId || "").trim();
  if (!grabItemId || !productId) {
    return NextResponse.json({ error: "grabItemId and productId are required" }, { status: 400 });
  }

  // Guard against a typo'd product id (FK would 500 with a raw error).
  const prod = await prisma.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
    SELECT id, name FROM products WHERE id = ${productId} LIMIT 1
  `);
  if (prod.length === 0) {
    return NextResponse.json({ error: "Unknown productId" }, { status: 404 });
  }
  const productName = prod[0].name;
  const label = body.label?.trim() || null;
  const lastPrice = typeof body.lastPrice === "number" ? Math.round(body.lastPrice) : null;

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO grab_item_links (grab_item_id, product_id, label, last_price, updated_at)
    VALUES (${grabItemId}, ${productId}, ${label}, ${lastPrice}, now())
    ON CONFLICT (grab_item_id)
    DO UPDATE SET product_id = EXCLUDED.product_id,
                  label      = COALESCE(EXCLUDED.label, grab_item_links.label),
                  last_price = COALESCE(EXCLUDED.last_price, grab_item_links.last_price),
                  updated_at = now()
  `);

  // Backfill already-received Grab lines that still hold the raw Grab id, so
  // in-progress/recent dockets, the order history, and reports show the real
  // product — and the printer's kitchen_station lookup starts resolving.
  const backfilled = await prisma.$executeRaw(Prisma.sql`
    UPDATE pos_order_items
    SET product_id = ${productId}, product_name = ${productName}
    WHERE product_id = ${grabItemId}
      AND order_id IN (SELECT id FROM pos_orders WHERE source = 'grabfood')
  `);

  return NextResponse.json({ success: true, grabItemId, productId, productName, backfilled });
}

export async function DELETE(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { grabItemId?: string };
  const grabItemId = (body.grabItemId || "").trim();
  if (!grabItemId) return NextResponse.json({ error: "grabItemId required" }, { status: 400 });

  // Remove the mapping only — past backfilled order lines are left intact.
  const removed = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM grab_item_links WHERE grab_item_id = ${grabItemId}
  `);
  if (removed === 0) return NextResponse.json({ error: "link not found" }, { status: 404 });
  return NextResponse.json({ success: true, grabItemId });
}
