/**
 * Order-type (Takeaway / Dine-In) helpers shared by the cart, checkout, menu
 * chip, and the dine-in scanner — so every surface agrees on labels, the
 * loyalty channel an order type maps to, and whether an applied reward is
 * valid for the chosen channel.
 *
 * The stored value stays "pickup" (what the server + POS expect); we only
 * *label* it "Takeaway" in the UI to match the McDonald's-style toggle and
 * the in-store signage.
 */
import type { AppliedReward, CartItem } from "./store";
import { cartTotal } from "./store";

export type OrderType = "pickup" | "dine_in";

/** Customer-facing label for the toggle + summaries. The app's established
 *  term is "Pickup" (the outlet picker, "Pickup from X"), so we use it over
 *  "Takeaway" for consistency across home / cart / checkout. */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  pickup: "Pickup",
  dine_in: "Dine-In",
};

/** Short tagline under each toggle option. */
export const ORDER_TYPE_TAGLINE: Record<OrderType, string> = {
  pickup: "Grab from the counter",
  dine_in: "Served to your table",
};

/** Normalise the nullable store field to a concrete type. Mirrors the server
 *  + checkout, which both default a null orderType to pickup. */
export function resolveOrderType(
  orderType: "pickup" | "dine_in" | null | undefined,
): OrderType {
  return orderType === "dine_in" ? "dine_in" : "pickup";
}

/** Loyalty channel for an order type — mirrors the server's
 *  channelForOrderType (apps/order/src/lib/loyalty/promotions.ts):
 *  dine_in → qr_table, else → pickup. */
export function channelForOrderType(
  orderType: "pickup" | "dine_in" | null | undefined,
): "qr_table" | "pickup" {
  return orderType === "dine_in" ? "qr_table" : "pickup";
}

/**
 * Aliases accepted on a reward's `fulfillment_type` for each order type.
 * Tolerant of the various spellings the catalog might use (dine_in / dine-in
 * / qr_table / qr) so Track C can set the field without the client needing a
 * lockstep release. An empty / missing fulfillment_type = no restriction.
 */
const CHANNEL_ALIASES: Record<OrderType, string[]> = {
  pickup: ["pickup", "takeaway", "take_away", "to_go", "togo"],
  dine_in: ["dine_in", "dine-in", "dinein", "qr_table", "qr", "table", "dine"],
};

export type RewardValidity = { valid: true } | { valid: false; reason: string };

/**
 * Re-validate the applied reward against the current order type + cart, the
 * way the McDonald's "Voucher Invalid" card does. Returns the FIRST failure so
 * the checkout panel can show one clear reason. The server stays authoritative
 * at order time — this is the client surface so a customer never reaches
 * "Place order" with a reward that will silently drop.
 *
 * Today every reward has a null fulfillment_type, so the channel check is a
 * no-op (nothing is restricted); it activates once specific rewards are
 * channel-scoped (Track C). The min-spend + qualifying-item checks are live now.
 */
export function validateAppliedReward(
  reward: AppliedReward | null,
  cart: CartItem[],
  orderType: "pickup" | "dine_in" | null | undefined,
): RewardValidity {
  if (!reward) return { valid: true };
  const ot = resolveOrderType(orderType);

  // 1. Channel eligibility. fulfillment_type lists the channels a reward
  //    supports; empty / missing = unrestricted. When set and the current
  //    channel isn't listed, the reward can't be used here.
  const ft = reward.fulfillment_type;
  if (Array.isArray(ft) && ft.length > 0) {
    const allowed = ft.some((c) => CHANNEL_ALIASES[ot].includes(String(c).toLowerCase()));
    if (!allowed) {
      return {
        valid: false,
        reason:
          ot === "dine_in"
            ? "Not valid for dine-in orders."
            : "Not valid for takeaway orders.",
      };
    }
  }

  // 2. Minimum order value. Stored in SEN; the cart subtotal is in RM, so
  //    compare against min_order_value / 100 (mirrors calcRewardDiscount).
  if (reward.min_order_value != null && reward.min_order_value > 0) {
    const minRm = reward.min_order_value / 100;
    if (cartTotal(cart) < minRm) {
      return { valid: false, reason: `Spend RM${formatAmount(minRm)} to use this reward.` };
    }
  }

  // 3. Qualifying items. free_item / bogo / combo rewards that target a
  //    category or product set need at least one matching line in the cart.
  const targeted =
    reward.discount_type === "free_item" ||
    reward.discount_type === "bogo" ||
    reward.discount_type === "combo";
  const cats = reward.applicable_categories;
  const prods = reward.applicable_products;
  const hasCatFilter = Array.isArray(cats) && cats.length > 0;
  const hasProdFilter = Array.isArray(prods) && prods.length > 0;
  if (targeted && (hasCatFilter || hasProdFilter)) {
    const ok = cart.some(
      (i) =>
        (hasProdFilter && prods!.includes(i.productId)) ||
        (hasCatFilter && i.category != null && cats!.includes(i.category)),
    );
    if (!ok) {
      return { valid: false, reason: `Add a qualifying item to use ${reward.name}.` };
    }
  }

  return { valid: true };
}

function formatAmount(rm: number): string {
  return rm % 1 === 0 ? rm.toFixed(0) : rm.toFixed(2);
}
