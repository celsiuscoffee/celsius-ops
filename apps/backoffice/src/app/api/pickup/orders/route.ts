import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0"))  return `+6${digits}`;
  return `+60${digits}`;
}

// Outlet identifiers differ between the two order tables: the customer
// app (orders.store_id) uses slugs ("shah-alam"); the register
// (pos_orders.outlet_id) uses ids ("outlet-sa"). Normalise pos rows to
// the slug so the unified list shows one consistent outlet column.
const SLUG_TO_OUTLET_ID: Record<string, string> = {
  "shah-alam": "outlet-sa",
  "conezion": "outlet-con",
  "tamarind": "outlet-tam",
  "nilai": "outlet-nilai",
};
const OUTLET_ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_OUTLET_ID).map(([slug, id]) => [id, slug]),
);

// GET /api/pickup/orders — unified orders across every sales channel.
// Query params:
//   from       ISO timestamp lower bound (inclusive) on created_at
//   to         YYYY-MM-DD upper bound (inclusive, sets to end-of-day)
//   store      Outlet slug, e.g. "conezion". "all" = no filter.
//   status     Single status filter (legacy). "all" = no filter.
//   statuses   Comma-separated status list (preferred).
//   phone      Customer phone (normalised to +60...).
//   channel    "all" | "pickup" (order-ahead: pickup/takeaway from the
//              `orders` table, excluding dine-in) | "qr" (table-QR dine-in
//              self-orders, also from `orders`) | "pos" (in-store register)
//              | "grab" (GrabFood). pos/grab read `pos_orders`. Omitting the
//              param returns every `orders`-table row (back-compat default).
//   limit      Cap on rows returned. Default 200, hard ceiling 2000.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = request.nextUrl;
    const from     = searchParams.get("from");
    const to       = searchParams.get("to");
    const store    = searchParams.get("store");
    const status   = searchParams.get("status");
    const statuses = searchParams.get("statuses");
    const phone    = searchParams.get("phone");
    // channelParam is the *raw* requested channel ("" when omitted). Only an
    // explicit "pickup"/"qr" applies the dine-in split below, so callers that
    // don't ask for a channel (e.g. the customer-retention analytics page) keep
    // their original scope — every order_type, no register rows. The unified
    // Orders list + Dashboard opt into "all".
    const channelParam = (searchParams.get("channel") || "").toLowerCase();
    const channel  = channelParam || "pickup";
    const limitRaw = Number(searchParams.get("limit"));
    const limit    = Math.min(2000, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200));

    const supabase = getSupabaseAdmin();

    const fromIso = from && from !== "" ? new Date(from).toISOString() : null;
    const toIso   = to   && to   !== "" ? new Date(to + "T23:59:59").toISOString() : null;
    const statusList =
      statuses && statuses !== ""
        ? statuses.split(",").map((s) => s.trim()).filter(Boolean)
        : status && status !== "all"
          ? [status]
          : [];
    const phoneNorm = phone && phone !== "" ? normalisePhone(phone) : null;

    const wantPickup = channel === "all" || channel === "pickup" || channel === "qr";
    const wantPos    = channel === "all" || channel === "pos" || channel === "grab";

    // ── Customer-app orders (pickup / web / QR-table) ──
    const pickupPromise = wantPickup
      ? (async () => {
          let q = supabase
            .from("orders")
            .select("*, order_items(*)")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (fromIso) q = q.gte("created_at", fromIso);
          if (toIso)   q = q.lte("created_at", toIso);
          if (store && store !== "all") q = q.eq("store_id", store);
          if (statusList.length) q = q.in("status", statusList);
          if (phoneNorm) q = q.eq("customer_phone", phoneNorm);
          // Split customer-app orders: "pickup" = order-ahead (pickup/takeaway),
          // "qr" = dine-in table-QR self-orders. Only filter when a caller asks
          // for one of those explicitly; an unscoped/default call returns all.
          if (channelParam === "pickup") q = q.neq("order_type", "dine_in");
          if (channelParam === "qr")     q = q.eq("order_type", "dine_in");
          const { data, error } = await q;
          if (error) throw error;
          return (data ?? []).map((o) => ({
            ...o,
            channel: o.order_type === "dine_in" ? "qr" : "pickup",
          }));
        })()
      : Promise.resolve([] as Record<string, unknown>[]);

    // ── Register orders (in-store + Grab/delivery) ──
    const posPromise = wantPos
      ? (async () => {
          let q = supabase
            .from("pos_orders")
            .select(
              "id, order_number, outlet_id, source, order_type, status, customer_name, customer_phone, subtotal, discount_amount, sst_amount, service_charge, total, notes, created_at, pos_order_items(product_name, quantity, item_total)",
            )
            .order("created_at", { ascending: false })
            .limit(limit);
          if (fromIso) q = q.gte("created_at", fromIso);
          if (toIso)   q = q.lte("created_at", toIso);
          if (store && store !== "all") q = q.eq("outlet_id", SLUG_TO_OUTLET_ID[store] ?? store);
          if (statusList.length) q = q.in("status", statusList);
          if (phoneNorm) q = q.eq("customer_phone", phoneNorm);
          if (channel === "pos")  q = q.eq("source", "pos");
          if (channel === "grab") q = q.eq("source", "grabfood");
          const { data, error } = await q;
          if (error) throw error;
          // Normalise to the OrderRow shape the list renders, + channel.
          return (data ?? []).map((o) => {
            const oid = o.outlet_id as string;
            const src = (o.source as string) ?? "pos";
            return {
              id: o.id,
              order_number: o.order_number,
              store_id: OUTLET_ID_TO_SLUG[oid] ?? oid,
              status: o.status,
              payment_method: "",
              payment_provider_ref: null,
              subtotal: o.subtotal ?? 0,
              discount_amount: o.discount_amount ?? 0,
              voucher_code: null,
              reward_discount_amount: 0,
              first_order_discount_amount: 0,
              reward_id: null,
              reward_name: null,
              sst_amount: o.sst_amount ?? 0,
              total: o.total ?? 0,
              customer_name: o.customer_name ?? null,
              customer_phone: o.customer_phone ?? null,
              loyalty_phone: null,
              loyalty_id: null,
              loyalty_points_earned: 0,
              notes: o.notes ?? null,
              created_at: o.created_at,
              updated_at: o.created_at,
              // Map pos_order_items → the same {product_name, quantity,
              // item_total} shape order_items uses, so item-level consumers
              // (e.g. the dashboard's Top Products) include pos/grab sales.
              order_items: Array.isArray((o as { pos_order_items?: unknown }).pos_order_items)
                ? ((o as { pos_order_items: Array<{ product_name?: string; quantity?: number; item_total?: number }> }).pos_order_items).map((it) => ({
                    product_name: it.product_name ?? "",
                    quantity: it.quantity ?? 0,
                    item_total: it.item_total ?? 0,
                  }))
                : [],
              channel: src === "grabfood" ? "grab" : src,
            };
          });
        })()
      : Promise.resolve([] as Record<string, unknown>[]);

    const [pickupRows, posRows] = await Promise.all([pickupPromise, posPromise]);

    // Merge, newest first, capped at the requested limit.
    const merged = [...pickupRows, ...posRows]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);

    return NextResponse.json(merged);
  } catch (err) {
    console.error("Orders error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
