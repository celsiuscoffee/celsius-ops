import { describe, it, expect, vi } from "vitest";

// ── Drift documentation: native ports vs the canonical engine ────────
//
// The Expo apps can't import @celsius/shared (outside the workspace), so
// each keeps a hand-written port of computeVoucherDiscount:
//   apps/pos-native/lib/loyalty.ts      computeRewardDiscount  (sen, client-AUTHORITATIVE)
//   apps/pickup-native/lib/rewards.ts   calcRewardDiscount     (RM, preview-only)
//
// These tests run the SAME carts through the canonical engine and each
// port, asserting where they agree and — more importantly — pinning down
// where they currently DIVERGE. Every `DRIFT:` block below is a real
// behavioral difference shipping today; the Phase 3 consolidation
// (docs/architecture-restructure-plan.md) is done when the drift cases
// can be rewritten as parity cases.
//
// The native lib/api modules import expo-constants / react-native, so
// they're mocked out — the discount functions under test are pure.

vi.mock("../apps/pos-native/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("../apps/pickup-native/lib/api", () => ({
  buildHeaders: vi.fn(() => ({})),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { computeVoucherDiscount } from "../packages/shared/src/loyalty/discount-engine";
import type { VoucherDiscountSpec } from "../packages/shared/src/loyalty/discount-engine";
import { computeRewardDiscount } from "../apps/pos-native/lib/loyalty";
import type { RedeemDiscount } from "../apps/pos-native/lib/loyalty";
import type { CartLine as PosCartLine } from "../apps/pos-native/lib/cart";
import { calcRewardDiscount } from "../apps/pickup-native/lib/rewards";

// One latte RM15 base + RM2 oat milk, one kopi RM9 no add-ons.
// Engine cart follows the POS convention here (unit price INCLUDES
// modifiers) unless a case says otherwise.
function engineSpec(overrides: Partial<VoucherDiscountSpec>): VoucherDiscountSpec {
  return {
    discount_type: null,
    discount_value: null,
    max_discount_value_sen: null,
    min_order_value_sen: null,
    applicable_categories: null,
    applicable_products: null,
    free_product_ids: null,
    free_product_name: null,
    ...overrides,
  };
}

function posDiscount(overrides: Partial<RedeemDiscount>): RedeemDiscount {
  return {
    type: null,
    value: null,
    max_discount: null,
    min_order: null,
    applicable_products: null,
    applicable_categories: null,
    free_product_ids: null,
    free_product_name: null,
    bogo_buy_qty: null,
    bogo_free_qty: null,
    combo_price_sen: null,
    override_price_sen: null,
    ...overrides,
  };
}

function posLine(args: {
  id?: string;
  name?: string;
  category?: string | null;
  base_sen: number;
  mod_sen?: number;
  qty?: number;
}): PosCartLine {
  return {
    key: `${args.id ?? "p-latte"}-k`,
    product: {
      id: args.id ?? "p-latte",
      name: args.name ?? "Latte",
      category: args.category ?? "coffee",
      price_sen: args.base_sen,
    },
    qty: args.qty ?? 1,
    modifiers: [],
    unit_sen: args.base_sen + (args.mod_sen ?? 0),
  } as unknown as PosCartLine;
}

describe("POS port (computeRewardDiscount) vs canonical engine", () => {
  it("PARITY: flat / percent / free_item / bogo / combo / override on the same sen cart", () => {
    const engineCart = [
      { product_id: "p-latte", quantity: 1, unit_price_sen: 1700, modifier_total_sen: 200, category: "coffee", category_id: null, name: "Latte" },
      { product_id: "p-kopi", quantity: 2, unit_price_sen: 900, modifier_total_sen: 0, category: "coffee", category_id: null, name: "Kopi" },
    ];
    const posCart = [
      posLine({ base_sen: 1500, mod_sen: 200 }),
      posLine({ id: "p-kopi", name: "Kopi", base_sen: 900, qty: 2 }),
    ];

    const cases: Array<[Partial<VoucherDiscountSpec>, Partial<RedeemDiscount> & Record<string, unknown>]> = [
      [{ discount_type: "flat", discount_value: 500 }, { type: "flat", value: 500 }],
      [
        { discount_type: "percent", discount_value: 15, max_discount_value_sen: 400 },
        { type: "percent", value: 15, max_discount: 400 },
      ],
      [{ discount_type: "free_item" }, { type: "free_item" }],
      [{ discount_type: "bogo" }, { type: "bogo" }],
      [
        { discount_type: "combo", applicable_products: ["p-latte", "p-kopi"], combo_price_sen: 2000 },
        { type: "combo", applicable_products: ["p-latte", "p-kopi"], combo_price_sen: 2000 },
      ],
      [
        { discount_type: "override_price", override_price_sen: 500 },
        { type: "override_price", override_price_sen: 500 },
      ],
    ];

    for (const [specOverrides, posOverrides] of cases) {
      const engine = computeVoucherDiscount({ spec: engineSpec(specOverrides), cart: engineCart });
      const pos = computeRewardDiscount(posDiscount(posOverrides), posCart);
      expect(pos, `type=${specOverrides.discount_type}`).toBe(engine.discount_sen);
    }
  });

  it("PARITY: removed free_upgrade type yields 0 in both (graceful, no crash)", () => {
    // free_upgrade was removed 2026-06-12 — the chain sells no upgrades
    // and the only template never issued a voucher. Residual rows must
    // no-op identically at the till and on the server.
    const engine = computeVoucherDiscount({
      spec: engineSpec({ discount_type: "free_upgrade" as never }),
      cart: [
        { product_id: "p-latte", quantity: 1, unit_price_sen: 1700, modifier_total_sen: 200, category: "coffee", category_id: null, name: "Latte" },
      ],
    });
    const pos = computeRewardDiscount(
      posDiscount({ type: "free_upgrade" }),
      [posLine({ base_sen: 1500, mod_sen: 200 })],
    );
    expect(engine.reason).toBe("unsupported_discount_type");
    expect(engine.discount_sen).toBe(0);
    expect(pos).toBe(0);
  });

  it("DRIFT: category eligibility — engine matches slug OR category_id, POS matches slug only", () => {
    const spec = engineSpec({ discount_type: "flat", discount_value: 500, applicable_categories: ["cat-uuid-1"] });
    const engine = computeVoucherDiscount({
      spec,
      cart: [
        { product_id: "p-latte", quantity: 1, unit_price_sen: 1500, category: null, category_id: "cat-uuid-1", name: "Latte" },
      ],
    });
    expect(engine.discount_sen).toBe(500); // engine: eligible via category_id

    const pos = computeRewardDiscount(
      posDiscount({ type: "flat", value: 500, applicable_categories: ["cat-uuid-1"] }),
      [posLine({ base_sen: 1500, category: null })], // POS lines carry only the slug
    );
    expect(pos).toBe(0); // POS: no slug → ineligible
  });

  it("PARITY: min-order gate yields 0 in both (engine additionally reports the reason)", () => {
    const engine = computeVoucherDiscount({
      spec: engineSpec({ discount_type: "flat", discount_value: 500, min_order_value_sen: 5000 }),
      cart: [
        { product_id: "p-kopi", quantity: 1, unit_price_sen: 900, category: "coffee", category_id: null, name: "Kopi" },
      ],
    });
    const pos = computeRewardDiscount(
      posDiscount({ type: "flat", value: 500, min_order: 5000 }),
      [posLine({ id: "p-kopi", name: "Kopi", base_sen: 900 })],
    );
    expect(engine.discount_sen).toBe(0);
    expect(engine.reason).toBe("below_min_order");
    expect(pos).toBe(0);
  });
});

describe("Pickup preview port (calcRewardDiscount, RM) vs canonical engine", () => {
  // Pickup items carry RM prices; the port returns RM. The server
  // recomputes authoritatively, so drift here = the customer previews a
  // number that won't match their receipt.
  const items = [
    { productId: "p-latte", category: "coffee", basePrice: 15, totalPrice: 17, quantity: 1 }, // +RM2 oat
    { productId: "p-kopi", category: "coffee", basePrice: 9, totalPrice: 18, quantity: 2 },
  ];
  const subtotalRm = 35;

  it("DRIFT: flat preview is NOT capped by the cart/eligible subtotal", () => {
    // RM50 flat voucher on a RM35 cart.
    const preview = calcRewardDiscount({ discount_type: "flat", discount_value: 5000 }, items, subtotalRm);
    expect(preview).toBe(50); // shows RM50 off a RM35 cart

    const engine = computeVoucherDiscount({
      spec: engineSpec({ discount_type: "flat", discount_value: 5000 }),
      cart: [
        { product_id: "p-latte", quantity: 1, unit_price_sen: 1500, category: "coffee", category_id: null, name: "Latte" },
        { product_id: "p-kopi", quantity: 2, unit_price_sen: 900, category: "coffee", category_id: null, name: "Kopi" },
      ],
    });
    expect(engine.discount_sen).toBe(3300); // server clamps to the cart
  });

  it("DRIFT: percent preview ignores max_discount_value AND eligible-set scoping", () => {
    // 50% capped at RM4, scoped to lattes. Engine: 50% of RM15 = 7.50 → capped 4.00.
    const engine = computeVoucherDiscount({
      spec: engineSpec({
        discount_type: "percent",
        discount_value: 50,
        max_discount_value_sen: 400,
        applicable_products: ["p-latte"],
      }),
      cart: [
        { product_id: "p-latte", quantity: 1, unit_price_sen: 1500, category: "coffee", category_id: null, name: "Latte" },
        { product_id: "p-kopi", quantity: 2, unit_price_sen: 900, category: "coffee", category_id: null, name: "Kopi" },
      ],
    });
    expect(engine.discount_sen).toBe(400);

    // Preview: 50% of the WHOLE RM35 subtotal, uncapped → RM17.50.
    const preview = calcRewardDiscount(
      {
        discount_type: "percent",
        discount_value: 50,
        applicable_products: ["p-latte"],
      },
      items,
      subtotalRm,
    );
    expect(preview).toBe(17.5);
  });

  it("DRIFT: product filters are dropped when no cart item carries a category", () => {
    // Voucher scoped to p-mocha; cart has no mocha AND no categories
    // populated (legacy persisted carts). Port treats EVERYTHING as
    // eligible and frees the cheapest item; engine correctly finds no
    // eligible line.
    const bareItems = [{ productId: "p-kopi", basePrice: 9, totalPrice: 9, quantity: 1 }];
    const preview = calcRewardDiscount(
      { discount_type: "free_item", applicable_products: ["p-mocha"] },
      bareItems,
      9,
    );
    expect(preview).toBe(9); // frees the kopi — not even in the voucher's scope

    const engine = computeVoucherDiscount({
      spec: engineSpec({ discount_type: "free_item", applicable_products: ["p-mocha"] }),
      cart: [{ product_id: "p-kopi", quantity: 1, unit_price_sen: 900, category: null, category_id: null, name: "Kopi" }],
    });
    expect(engine.reason).toBe("no_eligible_items");
    expect(engine.discount_sen).toBe(0);
  });

  it("CONVENTION: free_item frees the BASE price (matches the server's buildEngineCart), unlike POS", () => {
    // Server convention (discount-spec.ts buildEngineCart): unit_price_sen
    // = BASE price; "free drink covers the base only". Pickup preview
    // mirrors that with basePrice. POS feeds unit_sen INCLUDING modifiers,
    // so the same free-drink voucher covers the add-ons at the till but
    // not in the app — a per-channel inconsistency to resolve in Phase 3.
    const preview = calcRewardDiscount({ discount_type: "free_item" }, items, subtotalRm);
    expect(preview).toBe(9); // cheapest base

    const posResult = computeRewardDiscount(
      posDiscount({ type: "free_item" }),
      [posLine({ base_sen: 1500, mod_sen: 200 }), posLine({ id: "p-kopi", name: "Kopi", base_sen: 900, mod_sen: 100, qty: 2 })],
    );
    expect(posResult).toBe(1000); // cheapest unit INCLUDING its RM1 add-on
  });

  it("PARITY: same-item bogo previews the server amount (base prices, cheapest freed)", () => {
    const preview = calcRewardDiscount({ discount_type: "bogo" }, items, subtotalRm);
    // Units by base price: [9, 9, 15] → floor(3/2)=1 freed → RM9.
    expect(preview).toBe(9);

    const engine = computeVoucherDiscount({
      spec: engineSpec({ discount_type: "bogo" }),
      cart: [
        { product_id: "p-latte", quantity: 1, unit_price_sen: 1500, category: "coffee", category_id: null, name: "Latte" },
        { product_id: "p-kopi", quantity: 2, unit_price_sen: 900, category: "coffee", category_id: null, name: "Kopi" },
      ],
    });
    expect(engine.discount_sen).toBe(900);
  });
});
