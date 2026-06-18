/**
 * "PushGrabMenu" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/menus
 *
 * GrabFood pushes the store's canonical menu (as it exists on Grab's side) to
 * the partner — carrying Grab's item id, the item NAME, and price. This is the
 * ONE place we ever learn a Grab item's name (order webhooks carry none), so:
 *   1. persist each item into grab_menu_items (id → name → price), and
 *   2. auto-link any item whose name uniquely matches a catalogue product by
 *      setting products.grab_item_id, then backfilling already-received order
 *      lines (name + product_id → fixes kitchen-station routing on reprint).
 *
 * This is the safety net for Grab-internal ("MYITE…") ids. When Grab sends our
 * own product id on orders, no link is needed and the order resolves directly.
 * Items with no unique name match are left for the BackOffice item-link panel.
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Push grab menu".
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { normalizeMenuName } from "@/lib/grab-menu";

type IncomingItem = { id?: string; itemID?: string; grabItemID?: string; name?: string; price?: number };
type IncomingCategory = { items?: IncomingItem[]; name?: string };

// Flatten Grab's menu payload (categories[].items[]) into {id, name, price}.
// Tolerant of field aliases across API versions.
function flattenItems(body: Record<string, unknown>): { id: string; name: string; price: number | null; category: string | null }[] {
  const categories = (body.categories as IncomingCategory[] | undefined) ?? [];
  const out: { id: string; name: string; price: number | null; category: string | null }[] = [];
  for (const c of categories) {
    for (const it of c.items ?? []) {
      const id = (it.id || it.itemID || it.grabItemID || "").trim();
      const name = (it.name || "").trim();
      if (!id || !name) continue;
      out.push({ id, name, price: typeof it.price === "number" ? it.price : null, category: c.name ?? null });
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  if (!(await verifyGrabPartnerToken(request))) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* tolerate empty / non-JSON body */
  }

  const merchantID = (body.merchantID || body.merchantId || "") as string;
  const items = flattenItems(body);
  console.log(`[grab:push-menu] received merchant=${merchantID} items=${items.length}`);

  // Nothing to persist (URL-reachability ping / empty push) → just ack.
  if (items.length === 0) return NextResponse.json({ success: true, items: 0 });

  let autoLinked = 0;
  try {
    const supabase = getSupabaseAdmin();

    // 1. Persist every item's name + price (idempotent upsert).
    await supabase.from("grab_menu_items").upsert(
      items.map((it) => ({
        grab_item_id: it.id,
        merchant_id: merchantID || null,
        name: it.name,
        price: it.price,
        category: it.category,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "grab_item_id" },
    );

    // 2. Auto-link by unique name. Only a single unmistakable name match is safe;
    //    ambiguous names stay for a manual pick in BackOffice.
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, grab_item_id")
      .eq("brand_id", "brand-celsius");
    const products = (prods ?? []) as { id: string; name: string; grab_item_id: string | null }[];

    // grab ids already assigned to a product (column is unique) → never reassign.
    const takenGrabIds = new Set(products.map((p) => p.grab_item_id).filter(Boolean) as string[]);
    // normalised name → product ids WITHOUT a link yet (only those are linkable).
    const byName = new Map<string, string[]>();
    for (const p of products) {
      if (p.grab_item_id) continue;
      const key = normalizeMenuName(p.name);
      (byName.get(key) ?? byName.set(key, []).get(key)!).push(p.id);
    }
    const nameById = new Map(products.map((p) => [p.id, p.name] as const));

    for (const it of items) {
      if (takenGrabIds.has(it.id)) continue; // already linked to some product
      const matches = byName.get(normalizeMenuName(it.name));
      if (!matches || matches.length !== 1) continue; // none / ambiguous → manual
      const productId = matches[0];
      // Assign the link (sets products.grab_item_id), then backfill order lines.
      const { error: linkErr } = await supabase
        .from("products")
        .update({ grab_item_id: it.id })
        .eq("id", productId);
      if (linkErr) continue; // raced / unique violation — leave for manual.
      await supabase
        .from("pos_order_items")
        .update({ product_id: productId, product_name: nameById.get(productId) })
        .eq("product_id", it.id);
      // Don't reuse this product (or grab id) again within the same push.
      takenGrabIds.add(it.id);
      for (const [k, ids] of byName) {
        const i = ids.indexOf(productId);
        if (i >= 0) ids.splice(i, 1);
        if (ids.length === 0) byName.delete(k);
      }
      autoLinked += 1;
    }
    console.log(`[grab:push-menu] persisted=${items.length} auto-linked=${autoLinked} merchant=${merchantID}`);
  } catch (e) {
    // Never fail the webhook on a persistence hiccup — Grab retries any non-2xx
    // and the menu data isn't order-critical. Log and ack.
    console.error("[grab:push-menu] persist/auto-link failed:", e instanceof Error ? e.message : e);
  }

  // Ack — Grab retries on any non-2xx, so we only return non-200 on auth failure.
  return NextResponse.json({ success: true, items: items.length, autoLinked });
}

// Grab may GET to verify the URL is reachable before activation.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-push-menu" });
}
