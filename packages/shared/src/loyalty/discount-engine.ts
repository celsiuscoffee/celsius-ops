// Shared, canonical voucher-discount engine — single source of truth
// for the math that turns "voucher + cart" into "discount in sen".
// Directly imported by the Next.js apps:
//   * apps/order /api/orders/route.ts   (Pickup, server-AUTHORITATIVE at order create)
//   * apps/pos register page            (POS web, client-side on the in-store cart)
//   * apps/pos /api/loyalty/apply-voucher (descriptor builder for the register)
//
// MIRRORED (not imported) by the Expo apps — Metro can't resolve
// @celsius/shared, so these maintain hand-kept PORTS that must match the
// switch below case-for-case. Update them together:
//   * apps/pos-native/lib/loyalty.ts     computeRewardDiscount  (POS is client-authoritative)
//   * apps/pickup-native/lib/rewards.ts  calcRewardDiscount     (preview only; server recomputes)
//
// Was — two near-identical implementations with subtle drift:
//   * POS client used vocab `fixed_amount` / `percentage` and treated
//     discount_value as RM (multiplied by 100 to get sen).
//   * Pickup server used vocab `flat` / `percent` and treated
//     discount_value as sen directly for `flat`, RM for `fixed_amount`.
//   * POS factored `modifierTotal` into the free-item cheapest-line
//     calc; Pickup used just `unit_price`.
// All three are now expressed once, here.

import type { VoucherDiscountType } from "./active-vouchers";

/** Cart line shape the engine consumes. Both apps adapt their internal
 *  cart representations to this before calling computeVoucherDiscount.
 *
 *  `unit_price_sen` = the per-unit price the customer pays *including*
 *  modifier upcharges (large size, oat milk, extra shot, …). The
 *  free-item cheapest-line ranking sees the effective price the
 *  customer would have paid — voucher "pays for" the actual line.
 *
 *  `id` is optional (legacy callers can omit). When present it's
 *  echoed back in `eligible_line_ids` so the UI can highlight which
 *  lines the discount applied to. */
export type DiscountCartLine = {
  id?: string;
  product_id: string;
  quantity: number;
  unit_price_sen: number;
  /** Category slug — POS / Pickup pass either or both. Engine matches
   *  applicable_categories against either, so callers can supply
   *  whichever is canonical for their data. */
  category: string | null;
  /** Category UUID (or whatever the foreign-key shape is) — same dual
   *  match as category. */
  category_id: string | null;
  /** Product display name — used only as a last-resort fallback for
   *  legacy `free_product_name` matches. */
  name: string;
  /** The modifier-upcharge portion of unit_price_sen (oat milk, extra
   *  shot, large size, …) — i.e. unit_price_sen minus the base product
   *  price. Currently unused by any rule (free_upgrade was removed —
   *  the chain sells no upgrades); kept because callers already supply
   *  it and a future add-on rule would need it. */
  modifier_total_sen?: number | null;
};

/** Canonical v2 voucher spec — the engine's input. Always uses
 *  `flat` / `percent` / `free_item` / … vocabulary.
 *  POS's apply-voucher route translates from the legacy
 *  `fixed_amount` / `percentage` vocab to this before calling the
 *  engine.
 *
 *  Sen vs RM:
 *    discount_value          for `flat` is in SEN (e.g. RM5 = 500)
 *                            for `percent` is a raw percentage (e.g. 15)
 *    max_discount_value_sen  always SEN
 *    min_order_value_sen     always SEN */
export type VoucherDiscountSpec = {
  discount_type: VoucherDiscountType | null;
  discount_value: number | null;
  max_discount_value_sen: number | null;
  min_order_value_sen: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  /** BOGO knobs: buy `bogo_buy_qty`, get `bogo_free_qty` free (cheapest
   *  eligible units). Default 1/1 when null. */
  bogo_buy_qty?: number | null;
  bogo_free_qty?: number | null;
  /** Combo: the bundle's fixed total in SEN. Discount = (one unit of each
   *  required product) − combo_price_sen. The "required set" is
   *  applicable_products (ALL must be present in the cart). */
  combo_price_sen?: number | null;
  /** Override price: a single eligible item is repriced to this SEN
   *  value. Discount = cheapest eligible unit_price_sen − override_price_sen. */
  override_price_sen?: number | null;
};

export type DiscountReason =
  | "applied"
  | "below_min_order"
  | "no_eligible_items"
  | "no_discount_type"
  | "unsupported_discount_type"
  | "empty_cart";

export type DiscountResult = {
  /** Final discount in sen, capped at the eligible subtotal so the
   *  engine never tries to discount more than the cart actually holds. */
  discount_sen: number;
  /** Cart-line ids the discount applied to (empty when no lines were
   *  eligible, or when callers didn't supply ids). */
  eligible_line_ids: string[];
  /** Why the engine arrived at this discount. UI surfaces this for
   *  "voucher needs a qualifying drink" / "spend RM30+ to use" copy. */
  reason: DiscountReason;
};

const ZERO: DiscountResult = {
  discount_sen: 0,
  eligible_line_ids: [],
  reason: "no_eligible_items",
};

/** Return true when a cart line qualifies for a voucher's filters. */
function isLineEligible(line: DiscountCartLine, spec: VoucherDiscountSpec): boolean {
  const hasProductFilter = !!(spec.applicable_products && spec.applicable_products.length);
  const hasCategoryFilter = !!(spec.applicable_categories && spec.applicable_categories.length);
  const hasFreeProductIds = !!(spec.free_product_ids && spec.free_product_ids.length);
  const hasFreeProductName = !!spec.free_product_name;

  // No filter at all → every line is eligible.
  if (!hasProductFilter && !hasCategoryFilter && !hasFreeProductIds && !hasFreeProductName) {
    return true;
  }

  if (hasFreeProductIds && spec.free_product_ids!.includes(line.product_id)) return true;
  if (hasProductFilter && spec.applicable_products!.includes(line.product_id)) return true;
  if (hasCategoryFilter) {
    const cats = spec.applicable_categories!;
    if (line.category && cats.includes(line.category)) return true;
    if (line.category_id && cats.includes(line.category_id)) return true;
  }
  if (hasFreeProductName && line.name.toLowerCase() === spec.free_product_name!.toLowerCase()) {
    return true;
  }
  return false;
}

/** Compute the discount amount in sen for a voucher against a cart.
 *  Pure function — no DB, no network, no side effects.
 *
 *  Capping rules:
 *    - discount_sen is always >= 0
 *    - discount_sen is always <= eligible_subtotal_sen (the discount
 *      can't exceed the value of the lines it applies to)
 *    - For `percent`, the discount is further capped by
 *      max_discount_value_sen when set.
 *    - For `flat`, the discount is capped at discount_value (sen)
 *      AND at eligible_subtotal_sen.
 *    - For `free_item`, the discount is the cheapest eligible line's
 *      unit_price_sen.
 *
 *  Returns `reason` describing WHY the engine arrived at the result —
 *  the caller can surface that to the UI ("spend RM30+", "no eligible
 *  items", etc.). */
export function computeVoucherDiscount(args: {
  spec: VoucherDiscountSpec;
  cart: DiscountCartLine[];
}): DiscountResult {
  const { spec, cart } = args;
  if (cart.length === 0) {
    return { ...ZERO, reason: "empty_cart" };
  }

  const dt = spec.discount_type;
  if (!dt) {
    return { ...ZERO, reason: "no_discount_type" };
  }

  // Cart subtotal in sen — used for min_order check + percent base + cap.
  const cartSubtotalSen = cart.reduce((s, l) => s + l.unit_price_sen * l.quantity, 0);

  if (spec.min_order_value_sen != null && cartSubtotalSen < spec.min_order_value_sen) {
    return { ...ZERO, reason: "below_min_order" };
  }

  const eligible = cart.filter((l) => isLineEligible(l, spec));
  if (eligible.length === 0) {
    return { ...ZERO, reason: "no_eligible_items" };
  }

  const eligibleSubtotalSen = eligible.reduce((s, l) => s + l.unit_price_sen * l.quantity, 0);
  const eligibleIds = eligible.map((l) => l.id).filter((id): id is string => !!id);

  let discountSen = 0;

  switch (dt) {
    case "flat": {
      const dv = spec.discount_value ?? 0;
      discountSen = Math.min(Math.round(dv), eligibleSubtotalSen);
      break;
    }
    case "percent": {
      const dv = spec.discount_value ?? 0;
      let computed = Math.round((eligibleSubtotalSen * dv) / 100);
      if (spec.max_discount_value_sen != null) {
        computed = Math.min(computed, spec.max_discount_value_sen);
      }
      discountSen = Math.min(computed, eligibleSubtotalSen);
      break;
    }
    case "free_item": {
      // Cheapest eligible line's unit_price_sen. unit_price_sen
      // already includes modifier upcharges (the price the customer
      // would have paid for that line if voucher hadn't been applied),
      // so the discount equals the line's real cost.
      const cheapest = Math.min(...eligible.map((l) => l.unit_price_sen));
      discountSen = Number.isFinite(cheapest) ? cheapest : 0;
      break;
    }
    case "bogo": {
      const buyQty  = Math.max(1, Math.round(spec.bogo_buy_qty  ?? 1));
      const freeQty = Math.max(1, Math.round(spec.bogo_free_qty ?? 1));
      const freeSet = spec.free_product_ids ?? [];

      if (freeSet.length > 0) {
        // CROSS-ITEM BOGO ("buy X, get Y free"): the qualifying/buy set is
        // applicable_* (when neither is set, anything except the free item
        // qualifies); the free set is free_product_ids. For each buyQty
        // qualifying units purchased, free freeQty of the chosen free
        // product(s) — which must actually be in the cart.
        const hasApplicable =
          !!(spec.applicable_products && spec.applicable_products.length) ||
          !!(spec.applicable_categories && spec.applicable_categories.length);
        const isBuyLine = (l: DiscountCartLine): boolean => {
          if (freeSet.includes(l.product_id)) return false; // the free item never counts as a purchase
          if (!hasApplicable) return true;                  // scope=everything → any other item qualifies
          if (spec.applicable_products && spec.applicable_products.includes(l.product_id)) return true;
          if (spec.applicable_categories) {
            if (l.category && spec.applicable_categories.includes(l.category)) return true;
            if (l.category_id && spec.applicable_categories.includes(l.category_id)) return true;
          }
          return false;
        };
        const buyCount = cart.filter(isBuyLine).reduce((s, l) => s + l.quantity, 0);
        const allowance = Math.floor(buyCount / buyQty) * freeQty;
        const freeUnits: number[] = [];
        for (const l of cart) {
          if (freeSet.includes(l.product_id)) {
            for (let i = 0; i < l.quantity; i++) freeUnits.push(l.unit_price_sen);
          }
        }
        freeUnits.sort((a, b) => a - b); // cheapest free units first
        let freed = 0;
        for (let i = 0; i < Math.min(allowance, freeUnits.length); i++) freed += freeUnits[i];
        discountSen = freed;
      } else {
        // SAME-ITEM BOGO: complete (buy + free) groups over the eligible
        // pool; free the cheapest freeQty units per group. Multiple
        // complete groups stack.
        const units: number[] = [];
        for (const l of eligible) {
          for (let i = 0; i < l.quantity; i++) units.push(l.unit_price_sen);
        }
        units.sort((a, b) => a - b); // cheapest first → those get freed
        const totalFree = Math.floor(units.length / (buyQty + freeQty)) * freeQty;
        let freed = 0;
        for (let i = 0; i < totalFree && i < units.length; i++) freed += units[i];
        discountSen = freed;
      }
      break;
    }
    case "combo": {
      // Required set: EVERY product in applicable_products must be in the
      // cart. When satisfied, the bundle (one cheapest unit of each
      // required product) is repriced to combo_price_sen.
      const required = spec.applicable_products ?? [];
      if (required.length === 0 || spec.combo_price_sen == null) {
        return { ...ZERO, reason: "unsupported_discount_type" };
      }
      const present = new Set(cart.map((l) => l.product_id));
      if (!required.every((pid) => present.has(pid))) {
        return { ...ZERO, reason: "no_eligible_items" };
      }
      let bundleSen = 0;
      for (const pid of required) {
        const cheapestForPid = Math.min(
          ...cart.filter((l) => l.product_id === pid).map((l) => l.unit_price_sen),
        );
        if (Number.isFinite(cheapestForPid)) bundleSen += cheapestForPid;
      }
      discountSen = Math.max(0, bundleSen - spec.combo_price_sen);
      break;
    }
    case "override_price": {
      // A single eligible item is repriced to override_price_sen. Applied
      // to the CHEAPEST eligible unit (conservative — smallest saving) so
      // we never over-discount when multiple eligible items are present.
      if (spec.override_price_sen == null) {
        return { ...ZERO, reason: "unsupported_discount_type" };
      }
      const cheapest = Math.min(...eligible.map((l) => l.unit_price_sen));
      discountSen = Number.isFinite(cheapest)
        ? Math.max(0, cheapest - spec.override_price_sen)
        : 0;
      break;
    }
    case "beans_multiplier":
    case "none":
      // These don't translate to a cart discount. beans_multiplier
      // affects the bean award post-payment, "none" is the
      // placeholder for catalog rewards with no discount type.
      return { ...ZERO, reason: "unsupported_discount_type" };
    default: {
      // Belt-and-braces for future enum values added in DB.
      return { ...ZERO, reason: "unsupported_discount_type" };
    }
  }

  // Final guards — non-negative + bounded by what's actually on the
  // cart. The caller's downstream math should be able to trust that
  // discount_sen <= cart total.
  discountSen = Math.max(0, Math.min(discountSen, cartSubtotalSen));

  return {
    discount_sen: discountSen,
    eligible_line_ids: eligibleIds,
    reason: "applied",
  };
}

/** Translate POS's legacy `fixed_amount` / `percentage` vocab into the
 *  v2 spec the engine consumes. Mirrors the mapping that
 *  apps/pos /api/loyalty/apply-voucher's buildDiscount used to do.
 *  Use this on the API boundary so the engine itself never has to
 *  juggle two vocabularies. */
export function legacyDescriptorToSpec(legacy: {
  type: string;
  value: number;
  max_discount: number | null;
  min_order: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
}): VoucherDiscountSpec {
  // POS legacy `fixed_amount` carried discount_value as RM (multiplied
  // ×100 in the client to get sen). Engine takes sen. So translate
  // value to sen here for the flat case.
  const dt: VoucherDiscountType | null =
    legacy.type === "fixed_amount" ? "flat"
    : legacy.type === "percentage" ? "percent"
    : legacy.type === "free_item"  ? "free_item"
    : null;

  const discountValue: number | null =
    dt === "flat"    ? Math.round(legacy.value * 100)  // RM → sen
    : dt === "percent" ? legacy.value
    : null;

  return {
    discount_type: dt,
    discount_value: discountValue,
    max_discount_value_sen: legacy.max_discount != null ? Math.round(legacy.max_discount * 100) : null,
    min_order_value_sen:    legacy.min_order    != null ? Math.round(legacy.min_order    * 100) : null,
    applicable_categories:  legacy.applicable_categories,
    applicable_products:    legacy.applicable_products,
    free_product_ids:       legacy.free_product_ids,
    free_product_name:      legacy.free_product_name,
  };
}
