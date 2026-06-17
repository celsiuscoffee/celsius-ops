/**
 * GrabFood modifier-link admin API.
 *
 * Grab order modifiers arrive as { id, price } with NO name, so add-ons print
 * as "Add-on @ RM 0.97". This endpoint powers the panel that maps a Grab
 * modifier id → a real label (e.g. "Oat Milk"); the order webhook then resolves
 * names from grab_modifier_links.
 *
 * GET  → { items[], suggestions[], products[] }
 *        items: distinct Grab modifier ids seen in orders that aren't linked yet
 *               (id, price, timesOrdered, lastSeen). Populated from orders that
 *               landed AFTER the webhook started persisting grab_modifier_id.
 *        suggestions: catalogue modifier option labels (datalist hints).
 *        products: catalogue products for the optional association picker.
 * POST { grabModifierId, name, productId? } → upsert the link + backfill past
 *        order lines' modifier name.
 *
 * Raw SQL (parity with ../route.ts): these tables aren't in the Prisma client.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { Prisma } from "@prisma/client";

type UnlinkedModRow = {
  grab_modifier_id: string;
  times_ordered: bigint;
  min_price: number | null;
  max_price: number | null;
  last_seen: Date;
};

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [items, suggestions, products] = await Promise.all([
    prisma.$queryRaw<UnlinkedModRow[]>(Prisma.sql`
      SELECT m->>'grab_modifier_id'         AS grab_modifier_id,
             COUNT(*)                        AS times_ordered,
             MIN((m->>'price')::numeric)     AS min_price,
             MAX((m->>'price')::numeric)     AS max_price,
             MAX(oi.created_at)              AS last_seen
      FROM pos_order_items oi
      JOIN pos_orders o ON o.id = oi.order_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(oi.modifiers) = 'array' THEN oi.modifiers ELSE '[]'::jsonb END
      ) m
      WHERE o.source = 'grabfood'
        AND m->>'grab_modifier_id' IS NOT NULL
        AND m->>'grab_modifier_id' NOT IN (SELECT grab_modifier_id FROM grab_modifier_links)
      GROUP BY 1
      ORDER BY COUNT(*) DESC, MAX(oi.created_at) DESC
      LIMIT 100
    `),
    prisma.$queryRaw<{ label: string }[]>(Prisma.sql`
      SELECT DISTINCT opt->>'label' AS label
      FROM products p
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.modifiers) = 'array' THEN p.modifiers ELSE '[]'::jsonb END
      ) grp
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(grp->'options') = 'array' THEN grp->'options' ELSE '[]'::jsonb END
      ) opt
      WHERE p.brand_id = 'brand-celsius' AND COALESCE(opt->>'label', '') <> ''
      ORDER BY 1
    `),
    prisma.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
      SELECT id, name FROM products WHERE brand_id = 'brand-celsius' ORDER BY name ASC
    `),
  ]);

  return NextResponse.json({
    items: items.map((r) => ({
      grabModifierId: r.grab_modifier_id,
      timesOrdered: Number(r.times_ordered),
      minPriceRm: r.min_price != null ? Number(r.min_price) / 100 : null,
      maxPriceRm: r.max_price != null ? Number(r.max_price) / 100 : null,
      lastSeen: r.last_seen,
    })),
    suggestions: suggestions.map((s) => s.label),
    products: products.map((p) => ({ id: p.id, name: p.name })),
  });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    grabModifierId?: string;
    name?: string;
    productId?: string | null;
  };
  const grabModifierId = (body.grabModifierId || "").trim();
  const name = (body.name || "").trim();
  const productId = (body.productId || "").trim() || null;
  if (!grabModifierId || !name) {
    return NextResponse.json({ error: "grabModifierId and name are required" }, { status: 400 });
  }

  // 1. Upsert the link.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO grab_modifier_links (grab_modifier_id, name, product_id, updated_at)
    VALUES (${grabModifierId}, ${name}, ${productId}, now())
    ON CONFLICT (grab_modifier_id)
    DO UPDATE SET name = EXCLUDED.name, product_id = EXCLUDED.product_id, updated_at = now()
  `);

  // 2. Backfill the name onto past order lines' matching modifier elements.
  const contains = JSON.stringify([{ grab_modifier_id: grabModifierId }]);
  const backfilled = await prisma.$executeRaw(Prisma.sql`
    UPDATE pos_order_items
    SET modifiers = (
      SELECT jsonb_agg(
        CASE WHEN elem->>'grab_modifier_id' = ${grabModifierId}
             THEN jsonb_set(elem, '{name}', to_jsonb(${name}::text))
             ELSE elem END
      )
      FROM jsonb_array_elements(modifiers) elem
    )
    WHERE jsonb_typeof(modifiers) = 'array'
      AND modifiers @> ${contains}::jsonb
  `);

  // (No Grab push — modifier names live only on our docket/receipt, not on Grab.)
  return NextResponse.json({ success: true, grabModifierId, name, productId, backfilledLines: backfilled });
}
