/**
 * "PushGrabMenu" webhook (inbound — Grab → POS).
 *
 * POST /api/grab/menus
 *
 * During/after self-serve activation (and on a Grab-side menu change) GrabFood
 * pushes the store's canonical menu — the items as they exist ON GRAB, carrying
 * Grab's own item id ("MYITE…"), the item NAME, and price.
 *
 * This is the ONE place we ever learn a Grab item's name: order webhooks carry
 * no name, only the id. So we persist each item into grab_menu_items, then
 * auto-link any item whose name maps to exactly one of our products
 * (grab_item_links + backfill of already-received order lines). Items with no
 * unique name match are left for a manual pick in BackOffice → Integrations →
 * GrabFood → Item linking, where the stored name is now shown as the hint.
 *
 * Authenticated with the partner Bearer token Grab obtained from our
 * /api/grab/oauth/token endpoint. Register this URL in the portal
 * "Partner configuration → Push grab menu".
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { createClient } from "@/lib/supabase-server";
import { normalizeMenuName } from "@/lib/grab-menu";

type IncomingItem = { id?: string; itemID?: string; grabItemID?: string; name?: string; price?: number };
type IncomingCategory = { items?: IncomingItem[] };

// Flatten Grab's menu payload (categories[].items[]) into {id, name, price}.
// Tolerant of field aliases across API versions.
function flattenItems(body: Record<string, unknown>): { id: string; name: string; price: number | null }[] {
  const categories = (body.categories as IncomingCategory[] | undefined) ?? [];
  const out: { id: string; name: string; price: number | null }[] = [];
  for (const c of categories) {
    for (const it of c.items ?? []) {
      const id = (it.id || it.itemID || it.grabItemID || "").trim();
      const name = (it.name || "").trim();
      if (!id || !name) continue;
      out.push({ id, name, price: typeof it.price === "number" ? it.price : null });
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

  // Nothing to persist (URL-reachability ping or empty push) → just ack.
  if (items.length === 0) return NextResponse.json({ success: true, items: 0 });

  let autoLinked = 0;
  try {
    const supabase = await createClient();

    // 1. Persist every item's name + price (idempotent upsert).
    await supabase.from("grab_menu_items").upsert(
      items.map((it) => ({
        grab_item_id: it.id,
        merchant_id: merchantID || null,
        name: it.name,
        price: it.price,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "grab_item_id" },
    );

    // 2. Auto-link by name. Build a normalised-name → product index; only a
    //    UNIQUE name match is safe to auto-link (ambiguous names stay manual).
    const { data: prods } = await supabase.from("products").select("id, name");
    const byName = new Map<string, string[]>();
    for (const p of (prods ?? []) as { id: string; name: string }[]) {
      const key = normalizeMenuName(p.name);
      (byName.get(key) ?? byName.set(key, []).get(key)!).push(p.id);
    }

    // Skip ids already linked so we never override a manual decision.
    const ids = items.map((it) => it.id);
    const { data: existing } = await supabase
      .from("grab_item_links").select("grab_item_id").in("grab_item_id", ids);
    const linked = new Set((existing ?? []).map((r: { grab_item_id: string }) => r.grab_item_id));

    const productNameById = new Map(
      ((prods ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name] as const),
    );
    for (const it of items) {
      if (linked.has(it.id)) continue;
      const matches = byName.get(normalizeMenuName(it.name));
      if (!matches || matches.length !== 1) continue;
      const productId = matches[0];
      const { error: linkErr } = await supabase.from("grab_item_links").insert({
        grab_item_id: it.id,
        product_id: productId,
        label: it.name,
        last_price: it.price,
        updated_at: new Date().toISOString(),
      });
      if (linkErr) continue; // raced / FK miss — leave for manual.
      // Backfill already-received Grab lines holding the raw Grab id.
      await supabase
        .from("pos_order_items")
        .update({ product_id: productId, product_name: productNameById.get(productId) })
        .eq("product_id", it.id);
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
