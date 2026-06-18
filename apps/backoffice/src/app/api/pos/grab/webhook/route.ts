/**
 * Grab Webhook Receiver — handles Submit Order + Push Order State.
 *
 * Grab posts/PUTs here with x-grab-signature (HMAC-SHA256 over the raw body,
 * keyed on GRAB_HMAC_SECRET — falls back to GRAB_CLIENT_SECRET for staging
 * test stores that share secrets).
 *
 * Order ingestion writes to pos_orders / pos_order_items / pos_order_payments.
 * Outlet resolution: outlets.grab_merchant_id → outlets.storehub_store_id →
 * DEFAULT_OUTLET_ID env fallback.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { acceptRejectOrder, verifyWebhookSignature } from "@/lib/grab";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import {
  indexProductsByGrabKeys,
  resolveGrabItemProduct,
  fallbackGrabItemName,
  resolveGrabModifierName,
  resolveModifierNameFromCatalogue,
  type GrabItemProductRow,
  type CatalogueModifierGroup,
} from "@/lib/grab-order-items";
import { createClient } from "@/lib/supabase-server";
import { mapGrabStatusToPOS, resolveStatusTransition } from "@/lib/grab-order-status";

interface GrabOrderItemModifier {
  // Grab order modifiers carry NO name — only the partner modifier id + price + tax.
  // The name is resolved from our product modifiers by id.
  id?: string;
  price?: number;
  tax?: number;
  quantity?: number;
}

interface GrabOrderItem {
  // `id` = the item's externalID in OUR system (= products.id, what we shipped in
  // the menu). `grabItemID` = Grab's internal id. Order items carry NO name field
  // — the product name MUST be resolved from our catalogue by `id`.
  id: string;
  grabItemID?: string;
  quantity: number;
  price: number; // single item + its modifiers, tax-inclusive, in minor units
  tax?: number;
  specifications?: string; // the consumer's note for this line
  modifiers?: GrabOrderItemModifier[];
  comment?: string;
}

// Grab's order price object. The REAL payload key is `price`; the simulator
// sometimes sent `orderPrice`. eaterPayment is 0 for cashless orders — never use
// it as "the total". subtotal = tax-inclusive item+modifier total (the gross the
// merchant fulfils + books).
interface GrabOrderPrice {
  subtotal?: number;
  tax?: number;
  merchantChargeFee?: number;
  serviceChargeFee?: number;
  deliveryFee?: number;
  grabFundPromo?: number;
  merchantFundPromo?: number;
  eaterPayment?: number;
}

interface GrabWebhookPayload {
  orderID: string;
  shortOrderNumber: string;
  merchantID: string;
  partnerMerchantID?: string;
  paymentType: "CASH" | "CASHLESS";
  orderTime: string;
  submitTime: string;
  orderState:
    | "PENDING" | "ACCEPTED" | "DRIVER_ALLOCATED" | "DRIVER_ARRIVED"
    | "COLLECTED" | "DELIVERED" | "CANCELLED" | "FAILED";
  currency: { code: string; symbol: string; exponent: number };
  featureFlags: Record<string, boolean>;
  items: GrabOrderItem[];
  receiver?: {
    name: string;
    phones?: string[];
    address?: { unitNumber?: string; deliveryInstruction?: string };
  };
  price?: GrabOrderPrice;
  orderPrice?: GrabOrderPrice; // legacy / simulator alias
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
}

// Grab / the simulator put the order note in different places across API
// versions (receiver.address.deliveryInstruction vs a top-level comment /
// remarks / instructions). Capture the first non-empty candidate so it reaches
// the docket + receipt instead of being silently dropped.
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}
function extractOrderNote(p: GrabWebhookPayload): string | null {
  const r = p.receiver as { deliveryInstruction?: string; address?: { deliveryInstruction?: string } } | undefined;
  const x = p as unknown as Record<string, unknown>;
  return firstStr(
    r?.address?.deliveryInstruction, r?.deliveryInstruction,
    x.comment, x.comments, x.remarks, x.instructions, x.instruction, x.note, x.notes, x.orderNote, x.specialInstructions,
  );
}
function extractItemNote(it: GrabOrderItem): string | null {
  const x = it as unknown as Record<string, unknown>;
  // Grab's real field is `specifications`; the rest are simulator/legacy aliases.
  return firstStr(it.specifications, it.comment, x.comments, x.notes, x.note, x.instructions, x.remarks, x.specialInstructions);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-grab-signature") || "";

    // Accept EITHER a valid partner Bearer token (Grab simulator pattern —
    // they call /oauth/token first, then present that JWT here) OR a matching
    // HMAC signature (production-style webhook signing). Either is sufficient.
    const bearerOk = await verifyGrabPartnerToken(request);
    const hmacOk = !!signature && verifyWebhookSignature(rawBody, signature);
    if (!bearerOk && !hmacOk) {
      // Reject silently. NEVER echo computed HMAC candidates — doing so leaks
      // the expected signature and lets an attacker forge webhooks the moment a
      // real GRAB_HMAC_SECRET is set. Minimal, non-sensitive server log only.
      console.warn(`[grab:webhook] unauthorized bearer=${bearerOk} hmac=${hmacOk} sig_present=${!!signature}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: GrabWebhookPayload = JSON.parse(rawBody);
    const { orderID, orderState, merchantID } = payload;
    const supabase = await createClient();

    // Trace every authenticated webhook hit (otherwise "skipped" looks
    // identical to "ok" in the Vercel log table).
    const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    console.log(
      `[grab:webhook] hit method=${request.method} orderID=${orderID} state=${orderState ?? "<none>"} items=${itemCount} merchant=${merchantID}`,
    );

    // 1. Existing order → status update path.
    const { data: existing } = await supabase
      .from("pos_orders").select("id, status").eq("external_id", orderID).maybeSingle();
    if (existing) {
      // Forward-only: only persist a status that ADVANCES the order. A late,
      // duplicate or unrecognised state push is a no-op and can no longer drag a
      // ready/collected order back to "open".
      const mapped = mapGrabStatusToPOS(orderState);
      // Capture any state Grab sends that we don't model yet — logged with a
      // stable marker so the real string is greppable and the mapping can be
      // extended precisely (rather than guessed). Was previously swallowed by a
      // default → "open" fallback.
      if (mapped === null && orderState != null && String(orderState).trim() !== "") {
        console.warn(`[grab:webhook] UNMAPPED_STATE orderID=${orderID} state=${JSON.stringify(orderState)}`);
      }
      const newStatus = resolveStatusTransition(existing.status, mapped);
      if (newStatus) {
        await supabase.from("pos_orders")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
      return NextResponse.json({
        success: true,
        action: newStatus ? "updated" : "ignored",
        orderId: existing.id,
        state: orderState,
        status: newStatus ?? existing.status,
      });
    }

    // 2. Create whenever the payload carries items (Submit Order). Push
    //    Order State payloads carry no items — those legitimately fall
    //    through here when the matching order hasn't been created yet
    //    (race). The old strict allow-list dropped real Submit Orders
    //    whose orderState the simulator omitted.
    if (itemCount === 0) {
      console.log(`[grab:webhook] skipped — no items, state=${orderState ?? "<none>"} orderID=${orderID}`);
      return NextResponse.json({ success: true, action: "skipped", reason: "state-push-no-items", state: orderState });
    }

    // 3. Resolve outlet (grab_merchant_id primary, storehub_store_id fallback).
    // Resolve outlet: (1) Grab store ID → grab_merchant_id, else fall back to
    // the Partner store ID → storehub_store_id OR our outlet id itself. The deck
    // convention is "Partner store ID = POS outlet ID", so at go-live we can set
    // each store's Partner store ID to our outlet id (e.g. "outlet-sa") and it
    // resolves without needing grab_merchant_id pre-populated.
    const pmid = (payload.partnerMerchantID || "").trim();
    const orParts = [`grab_merchant_id.eq.${merchantID}`];
    if (pmid) orParts.push(`storehub_store_id.eq.${pmid}`, `id.eq.${pmid}`);
    const { data: outlet } = await supabase
      .from("outlets").select("id")
      .or(orParts.join(","))
      .maybeSingle();
    const outletId = outlet?.id || process.env.DEFAULT_OUTLET_ID || "";
    if (!outletId) {
      console.error(`[grab:webhook] no outlet linked for merchantID=${merchantID}`);
      return NextResponse.json(
        { error: "No outlet linked. Set outlets.grab_merchant_id in BackOffice → Integrations → GrabFood." },
        { status: 400 },
      );
    }

    // 4. Totals — minor units (sen). The REAL payload key is `price`; the
    //    simulator used `orderPrice`. Reading the wrong key is why every live
    //    order booked RM 0. `subtotal` is Grab's authoritative basket total;
    //    `eaterPayment` is the consumer-paid figure and is 0 for cashless orders,
    //    so it must NEVER be used as "the total".
    const price: GrabOrderPrice = payload.price ?? payload.orderPrice ?? {};
    const itemsArr = Array.isArray(payload.items) ? payload.items : [];
    // Fallback only if Grab omits the price block — sum the lines so a clearly
    // priced order never books 0.
    const itemsSubtotal = itemsArr.reduce(
      (n, it) =>
        n +
        ((it.price ?? 0) +
          (it.modifiers ?? []).reduce((m, md) => m + (md.price ?? 0) * (md.quantity ?? 1), 0)) *
          (it.quantity ?? 1),
      0,
    );
    const subtotal = price.subtotal && price.subtotal > 0 ? price.subtotal : itemsSubtotal;
    const sst = price.tax ?? 0;
    const merchantFees = (price.merchantChargeFee ?? 0) + (price.serviceChargeFee ?? 0);
    const discount = (price.grabFundPromo ?? 0) + (price.merchantFundPromo ?? 0);
    const total = subtotal + merchantFees;
    const orderType =
      payload.orderType === "DINE_IN" ? "dine_in" :
      payload.orderType === "PICKUP" ? "pickup" : "takeaway";

    // Capture the real money + id shape so the next live order confirms the
    // mapping (which price key, whether item.price includes modifiers, which id
    // matches our catalogue). Targeted — Vercel collapses long log lines.
    console.log(
      `[grab:webhook] money orderID=${orderID} key=${payload.price ? "price" : payload.orderPrice ? "orderPrice" : "none"} subtotal=${price.subtotal ?? "x"} tax=${price.tax ?? "x"} eater=${price.eaterPayment ?? "x"} itemsSubtotal=${itemsSubtotal} items=${JSON.stringify(itemsArr.map((i) => ({ id: i.id, gid: i.grabItemID, p: i.price, m: (i.modifiers ?? []).map((x) => x.price) })))}`,
    );

    // 5. Insert order. shortOrderNumber sometimes arrives already prefixed
    //    with "GF-", so strip any existing prefix to avoid "GF-GF-6782".
    const shortNo = (payload.shortOrderNumber ?? "").replace(/^GF-/i, "");
    const { data: order, error: orderErr } = await supabase
      .from("pos_orders")
      .insert({
        external_id: orderID,
        order_number: `GF-${shortNo || orderID.slice(0, 6)}`,
        outlet_id: outletId,
        source: "grabfood",
        order_type: orderType,
        status: "sent_to_kitchen",
        subtotal, sst_amount: sst, discount_amount: discount, total,
        customer_name: payload.receiver?.name || "Grab Customer",
        customer_phone: payload.receiver?.phones?.[0] || null,
        notes: extractOrderNote(payload),
      })
      .select("id").single();
    if (orderErr || !order) {
      // Duplicate-delivery race: a concurrent Submit Order for the same orderID
      // won the unique(external_id) insert. Treat as success so Grab stops
      // retrying the (already-created) order forever.
      if ((orderErr as { code?: string } | null)?.code === "23505") {
        const { data: dup } = await supabase
          .from("pos_orders").select("id").eq("external_id", orderID).maybeSingle();
        console.log(`[grab:webhook] duplicate submit orderID=${orderID} → existing id=${dup?.id ?? "?"}`);
        return NextResponse.json({ success: true, action: "duplicate", orderId: dup?.id ?? null });
      }
      console.error("[grab:webhook] insert pos_orders failed:", orderErr);
      return NextResponse.json(
        { error: `Failed to create order: ${orderErr?.message || "unknown"}` },
        { status: 500 },
      );
    }

    // 6. Items. Grab order items carry NO name field — the product name is
    //    resolved from our catalogue by the PARTNER id (item.id = products.id)
    //    OR the catalogue's `grab_item_id` (set in BackOffice when the Grab menu
    //    was created in Grab's portal, so the order only carries Grab's own id —
    //    e.g. "MYITE2026..." — which never matches products.id). grabItemID is
    //    the last fallback. (Looking up by grabItemID against products.id first
    //    was the "Item" bug: Grab's id never matches our ids.) `itemsArr` is §4.
    const candidateIds = Array.from(
      new Set(itemsArr.flatMap((i) => [i.id, i.grabItemID]).filter(Boolean) as string[]),
    );
    const productIndex = new Map<string, GrabItemProductRow>();
    // productId → catalogue modifier groups, for resolving add-on names from
    // our own minted ids ("<productId>-m-<g>-<i>") without a manual link.
    const modifiersByProductId = new Map<string, CatalogueModifierGroup[]>();
    if (candidateIds.length > 0) {
      // Match on EITHER the product id or its linked grab_item_id. Two narrow
      // queries (cheap, a handful of ids per order) avoid escaping arbitrary id
      // values into a single PostgREST `.or()` filter.
      const [byId, byGrab] = await Promise.all([
        supabase.from("products").select("id, name, grab_item_id, modifiers").in("id", candidateIds),
        supabase.from("products").select("id, name, grab_item_id, modifiers").in("grab_item_id", candidateIds),
      ]);
      const rows = [
        ...((byId.data ?? []) as GrabItemProductRow[]),
        ...((byGrab.data ?? []) as GrabItemProductRow[]),
      ];
      for (const [k, v] of indexProductsByGrabKeys(rows)) productIndex.set(k, v);
      for (const r of [...(byId.data ?? []), ...(byGrab.data ?? [])] as Array<{ id: string; modifiers?: unknown }>) {
        if (Array.isArray(r.modifiers)) modifiersByProductId.set(r.id, r.modifiers as CatalogueModifierGroup[]);
      }
    }

    // Modifier name resolution — Grab order modifiers carry only id + price.
    // Resolve real labels (e.g. "Oat Milk") from grab_modifier_links by id;
    // unmatched ones keep the "Add-on @ RM x" fallback. (We also persist the
    // grab_modifier_id on each line so unmatched ones can be linked later.)
    const modifierIds = Array.from(
      new Set(
        itemsArr.flatMap((i) => (i.modifiers ?? []).map((m) => m.id)).filter(Boolean) as string[],
      ),
    );
    const modifierNameById = new Map<string, string>();
    if (modifierIds.length > 0) {
      const { data: links } = await supabase
        .from("grab_modifier_links")
        .select("grab_modifier_id, name")
        .in("grab_modifier_id", modifierIds);
      for (const l of (links ?? []) as Array<{ grab_modifier_id: string; name: string }>) {
        modifierNameById.set(l.grab_modifier_id, l.name);
      }
    }
    const orderItems = itemsArr.map((item) => {
      const product = resolveGrabItemProduct(item, productIndex);
      const qty = item.quantity ?? 1;
      const unitPrice = item.price ?? 0;
      // Grab's item.price is ALREADY modifier-inclusive (see the GrabOrderItem
      // type: "single item + its modifiers, tax-inclusive"). modTotal is kept
      // for display + the catalogue base-price match (base = unitPrice − modTotal)
      // — but must NOT be added to the line total, or the receipt double-counts
      // the add-ons (e.g. RM11.80 item printed as RM13.70). The order subtotal
      // comes from Grab's price.subtotal = Σ unitPrice, so the line must match it.
      const modTotal = (item.modifiers ?? []).reduce((n, m) => n + (m.price ?? 0) * (m.quantity ?? 1), 0);
      const itemTotal = unitPrice * qty;
      return {
        id: randomUUID(),
        order_id: order.id,
        // Prefer the matched catalogue product id so the order line links back
        // to the catalogue; fall back to whatever Grab sent.
        product_id: product?.id || item.id || item.grabItemID || randomUUID(),
        product_name: product?.name || fallbackGrabItemName(item),
        // Grab's own line-level item id, kept verbatim for the Edit Order payload
        // (which keys existing lines by Grab's itemID). Distinct from product_id,
        // which we resolve to our catalogue for naming/kitchen routing.
        grab_item_id: item.grabItemID || item.id || null,
        quantity: qty,
        unit_price: unitPrice,
        modifiers: (item.modifiers ?? []).map((m) => ({
          // Grab order modifiers carry no name. Resolve in priority order:
          //   1. an explicit grab_modifier_links override (manual name), then
          //   2. our own catalogue, when the id is "<productId>-m-<g>-<i>"
          //      (auto — no link/manual naming needed since we minted it), then
          //   3. the "Add-on @ RM x" price fallback.
          // grab_modifier_id is still persisted so anything unmatched can be
          // linked from BackOffice and backfilled.
          grab_modifier_id: m.id ?? null,
          name:
            (m.id ? modifierNameById.get(m.id) : undefined) ??
            resolveModifierNameFromCatalogue(m.id, modifiersByProductId) ??
            resolveGrabModifierName(m, modifierNameById),
          price: m.price,
          qty: m.quantity,
        })),
        modifier_total: modTotal,
        discount_amount: 0,
        tax_amount: item.tax ?? 0,
        item_total: itemTotal,
        notes: extractItemNote(item),
        kitchen_status: "pending",
        created_at: new Date().toISOString(),
      };
    });
    if (orderItems.length > 0) {
      const { error: itemsErr } = await supabase.from("pos_order_items").insert(orderItems);
      if (itemsErr) console.error("[grab:webhook] items insert failed:", itemsErr);
    }

    // 7. Payment.
    const { error: payErr } = await supabase.from("pos_order_payments").insert({
      id: randomUUID(),
      order_id: order.id,
      payment_method: payload.paymentType === "CASH" ? "cash" : "grabpay",
      amount: total,
      status: "paid",
      provider: "grabfood",
      provider_ref: orderID,
      refund_amount: 0,
      created_at: new Date().toISOString(),
    });
    if (payErr) console.error("[grab:webhook] payment insert failed:", payErr);

    // 8. Auto-accept the order on Grab so it leaves PENDING and the lifecycle
    //    advances via the API — otherwise it sits "open" until someone accepts in
    //    the GrabMerchant app. The order is already recorded + printing locally,
    //    so this is best-effort: a failed or duplicate accept never fails the
    //    webhook. Uses the OUTBOUND OAuth pair (us → Grab).
    let grabAccepted = false;
    if (process.env.GRAB_CLIENT_ID && process.env.GRAB_CLIENT_SECRET) {
      try {
        await acceptRejectOrder(orderID, "ACCEPTED");
        grabAccepted = true;
        console.log(`[grab:webhook] auto-accepted orderID=${orderID}`);
      } catch (e) {
        console.warn(
          `[grab:webhook] auto-accept failed orderID=${orderID}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    console.log(
      `[grab:webhook] CREATED order=${order.id} external=${orderID} outlet=${outletId} total=${total} accepted=${grabAccepted}`,
    );
    return NextResponse.json({
      success: true,
      action: "created",
      orderId: order.id,
      orderNumber: `GF-${payload.shortOrderNumber}`,
      grabAccepted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : "";
    console.error(`[grab:webhook] EXCEPTION msg=${msg} stack=${stack}`);
    return NextResponse.json(
      { error: "Internal server error", debug: { msg, stack } },
      { status: 500 },
    );
  }
}

// Grab simulator sometimes uses PUT for Push Order State. Same handler.
export const PUT = POST;

// Grab may GET to verify reachability.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-webhook" });
}
