/**
 * GrabFood item-link admin API.
 *
 * GrabFood order webhooks carry only Grab's own item id (e.g. "MYITE2026...")
 * which never matches our products.id. Until a product carries that id in
 * products.grab_item_id, its Grab order lines print as "Item @ RM x" and
 * outbound price/availability pushes don't reach Grab. This endpoint powers the
 * BackOffice panel that links them.
 *
 * GET  → { items[], products[] }
 *        items: distinct Grab item ids seen in orders that aren't linked yet
 *               (id, price, timesOrdered, lastSeen), most-ordered first.
 *        products: catalogue products for the picker (id, name, category, grabPriceRm).
 * POST { grabItemId, productId } → link the item to a product. Clears the id
 *        from any other product first (the column is unique), then backfills
 *        past order lines' name + product_id so history reads correctly too.
 *
 * Raw SQL (parity with ../route.ts): products / pos_order_items aren't in the
 * generated Prisma client.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { autoSyncCatalogueToGrab } from "@/lib/grab-auto-sync";

type UnlinkedRow = {
  grab_item_id: string;
  times_ordered: bigint;
  min_price: number | null;
  max_price: number | null;
  last_seen: Date;
};

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  price_grab: number | null;
  price: number | null;
};

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [items, products] = await Promise.all([
    prisma.$queryRaw<UnlinkedRow[]>(Prisma.sql`
      SELECT oi.product_id AS grab_item_id,
             COUNT(*)            AS times_ordered,
             MIN(oi.unit_price)  AS min_price,
             MAX(oi.unit_price)  AS max_price,
             MAX(oi.created_at)  AS last_seen
      FROM pos_order_items oi
      JOIN pos_orders o ON o.id = oi.order_id
      WHERE o.source = 'grabfood'
        AND oi.product_id NOT IN (
          SELECT grab_item_id FROM products WHERE grab_item_id IS NOT NULL
        )
      GROUP BY oi.product_id
      ORDER BY COUNT(*) DESC, MAX(oi.created_at) DESC
      LIMIT 100
    `),
    prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT id, name, category, price_grab, price
      FROM products
      WHERE brand_id = 'brand-celsius'
      ORDER BY name ASC
    `),
  ]);

  return NextResponse.json({
    items: items.map((r) => ({
      grabItemId: r.grab_item_id,
      timesOrdered: Number(r.times_ordered),
      minPriceRm: r.min_price != null ? Number(r.min_price) / 100 : null,
      maxPriceRm: r.max_price != null ? Number(r.max_price) / 100 : null,
      lastSeen: r.last_seen,
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      grabPriceRm: p.price_grab != null ? Number(p.price_grab) : p.price != null ? Number(p.price) : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    grabItemId?: string;
    productId?: string;
  };
  const grabItemId = (body.grabItemId || "").trim();
  const productId = (body.productId || "").trim();
  if (!grabItemId || !productId) {
    return NextResponse.json({ error: "grabItemId and productId are required" }, { status: 400 });
  }

  // 1. Clear the id from any other product (grab_item_id is unique when set).
  await prisma.$executeRaw(Prisma.sql`
    UPDATE products SET grab_item_id = NULL
    WHERE grab_item_id = ${grabItemId} AND id <> ${productId}
  `);
  // 2. Assign it to the chosen product.
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE products SET grab_item_id = ${grabItemId} WHERE id = ${productId}
  `);
  if (updated === 0) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }
  // 3. Backfill past Grab order lines for this id so history reads correctly:
  //    the real product name + the catalogue product_id (which also fixes
  //    kitchen-station routing on any reprint).
  const backfilled = await prisma.$executeRaw(Prisma.sql`
    UPDATE pos_order_items oi
    SET product_name = p.name, product_id = p.id
    FROM products p
    WHERE p.id = ${productId} AND oi.product_id = ${grabItemId}
  `);

  // 4. Push the now-linked item's price/availability to Grab (best-effort, off
  //    the response path — same as a catalogue edit).
  after(() =>
    autoSyncCatalogueToGrab(getSupabaseAdmin())
      .then((r) => console.log(`[grab:link] ${grabItemId} → ${productId} synced`, JSON.stringify(r)))
      .catch((e) => console.error(`[grab:link] sync failed for ${productId}:`, e)),
  );

  return NextResponse.json({ success: true, grabItemId, productId, backfilledLines: backfilled });
}
