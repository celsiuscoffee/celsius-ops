import { describe, it, expect } from "vitest";
import {
  computeVoucherDiscount,
  legacyDescriptorToSpec,
  type DiscountCartLine,
  type VoucherDiscountSpec,
} from "../discount-engine";

// Characterization tests: lock in the engine's CURRENT behavior so the
// hand-kept ports in pos-native (computeRewardDiscount) and pickup-native
// (calcRewardDiscount) can be consolidated against a green suite, and so
// future edits to money math fail loudly. All amounts are SEN.

function line(overrides: Partial<DiscountCartLine> = {}): DiscountCartLine {
  return {
    id: overrides.id,
    product_id: "p-latte",
    quantity: 1,
    unit_price_sen: 1500,
    category: "coffee",
    category_id: "cat-coffee",
    name: "Latte",
    ...overrides,
  };
}

function spec(overrides: Partial<VoucherDiscountSpec> = {}): VoucherDiscountSpec {
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

describe("guard rails / reasons", () => {
  it("empty cart → empty_cart, 0", () => {
    const r = computeVoucherDiscount({ spec: spec({ discount_type: "flat", discount_value: 500 }), cart: [] });
    expect(r).toEqual({ discount_sen: 0, eligible_line_ids: [], reason: "empty_cart" });
  });

  it("null discount_type → no_discount_type", () => {
    const r = computeVoucherDiscount({ spec: spec(), cart: [line()] });
    expect(r.reason).toBe("no_discount_type");
    expect(r.discount_sen).toBe(0);
  });

  it("cart below min order → below_min_order", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 500, min_order_value_sen: 3000 }),
      cart: [line({ unit_price_sen: 1500 })],
    });
    expect(r.reason).toBe("below_min_order");
    expect(r.discount_sen).toBe(0);
  });

  it("cart exactly at min order passes (boundary is >=)", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 500, min_order_value_sen: 3000 }),
      cart: [line({ quantity: 2, unit_price_sen: 1500 })],
    });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(500);
  });

  it("min order is checked against the FULL cart, not just eligible lines", () => {
    // RM30 min met by the whole cart even though only RM15 is eligible.
    const r = computeVoucherDiscount({
      spec: spec({
        discount_type: "percent",
        discount_value: 10,
        min_order_value_sen: 3000,
        applicable_products: ["p-latte"],
      }),
      cart: [line({ unit_price_sen: 1500 }), line({ product_id: "p-cake", name: "Cake", unit_price_sen: 1600 })],
    });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(150); // 10% of the eligible RM15 only
  });

  it("product filter with no matching line → no_eligible_items", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 500, applicable_products: ["p-mocha"] }),
      cart: [line()],
    });
    expect(r.reason).toBe("no_eligible_items");
  });

  it("beans_multiplier and none → unsupported_discount_type", () => {
    for (const dt of ["beans_multiplier", "none"] as const) {
      const r = computeVoucherDiscount({ spec: spec({ discount_type: dt }), cart: [line()] });
      expect(r.reason).toBe("unsupported_discount_type");
      expect(r.discount_sen).toBe(0);
    }
  });

  it("unknown future enum value → unsupported_discount_type", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "mystery_new_type" as never }),
      cart: [line()],
    });
    expect(r.reason).toBe("unsupported_discount_type");
  });
});

describe("line eligibility filters", () => {
  it("no filters at all → every line eligible", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 10 }),
      cart: [line({ id: "a" }), line({ id: "b", product_id: "p-cake", name: "Cake" })],
    });
    expect(r.eligible_line_ids).toEqual(["a", "b"]);
  });

  it("matches applicable_categories against category slug OR category_id", () => {
    const bySlug = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 10, applicable_categories: ["coffee"] }),
      cart: [line({ id: "a", category: "coffee", category_id: null })],
    });
    expect(bySlug.reason).toBe("applied");

    const byId = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 10, applicable_categories: ["cat-coffee"] }),
      cart: [line({ id: "a", category: null, category_id: "cat-coffee" })],
    });
    expect(byId.reason).toBe("applied");
  });

  it("free_product_name matches case-insensitively as last resort", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_item", free_product_name: "LATTE" }),
      cart: [line({ name: "latte", unit_price_sen: 1200 })],
    });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(1200);
  });

  it("eligible_line_ids is empty when caller supplies no ids", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 100 }),
      cart: [line()],
    });
    expect(r.eligible_line_ids).toEqual([]);
    expect(r.reason).toBe("applied");
  });
});

describe("flat", () => {
  it("takes discount_value as SEN", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 500 }),
      cart: [line({ unit_price_sen: 2000 })],
    });
    expect(r.discount_sen).toBe(500);
  });

  it("caps at the eligible subtotal, not the cart subtotal", () => {
    // RM10 voucher scoped to a RM3 item in a RM33 cart frees only RM3.
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 1000, applicable_products: ["p-kopi"] }),
      cart: [
        line({ product_id: "p-kopi", name: "Kopi", unit_price_sen: 300 }),
        line({ product_id: "p-cake", name: "Cake", unit_price_sen: 3000 }),
      ],
    });
    expect(r.discount_sen).toBe(300);
  });

  it("null discount_value → applied with 0", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: null }),
      cart: [line()],
    });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(0);
  });

  it("rounds fractional sen", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 499.5 }),
      cart: [line({ unit_price_sen: 2000 })],
    });
    expect(r.discount_sen).toBe(500);
  });
});

describe("percent", () => {
  it("computes off the eligible subtotal", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 15 }),
      cart: [line({ quantity: 2, unit_price_sen: 1000 })],
    });
    expect(r.discount_sen).toBe(300);
  });

  it("Math.round on fractional results (10% of 1005 → 101)", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 10 }),
      cart: [line({ unit_price_sen: 1005 })],
    });
    expect(r.discount_sen).toBe(101);
  });

  it("respects max_discount_value_sen", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 50, max_discount_value_sen: 400 }),
      cart: [line({ unit_price_sen: 2000 })],
    });
    expect(r.discount_sen).toBe(400);
  });

  it("caps 100%+ at the eligible subtotal", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "percent", discount_value: 150 }),
      cart: [line({ unit_price_sen: 2000 })],
    });
    expect(r.discount_sen).toBe(2000);
  });
});

describe("free_item", () => {
  it("frees the cheapest eligible line's unit price — ONE unit even when qty > 1", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_item" }),
      cart: [line({ quantity: 3, unit_price_sen: 1200 })],
    });
    expect(r.discount_sen).toBe(1200);
  });

  it("picks the cheapest line across the eligible set", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_item" }),
      cart: [
        line({ unit_price_sen: 1800, product_id: "p-mocha", name: "Mocha" }),
        line({ unit_price_sen: 900, product_id: "p-kopi", name: "Kopi" }),
      ],
    });
    expect(r.discount_sen).toBe(900);
  });

  it("unit price includes modifier upcharges (voucher pays the real line price)", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_item", free_product_ids: ["p-latte"] }),
      cart: [line({ unit_price_sen: 1500 + 200, modifier_total_sen: 200 })],
    });
    expect(r.discount_sen).toBe(1700);
  });

  it("free_product_ids scopes which lines can be freed", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_item", free_product_ids: ["p-mocha"] }),
      cart: [
        line({ unit_price_sen: 900 }), // cheaper but not in the free set
        line({ product_id: "p-mocha", name: "Mocha", unit_price_sen: 1800 }),
      ],
    });
    expect(r.discount_sen).toBe(1800);
  });
});

describe("free_upgrade", () => {
  it("modifier-aware: frees the cheapest POSITIVE upcharge, not the drink", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_upgrade" }),
      cart: [
        line({ unit_price_sen: 1700, modifier_total_sen: 200 }),
        line({ product_id: "p-mocha", name: "Mocha", unit_price_sen: 1950, modifier_total_sen: 150 }),
      ],
    });
    expect(r.discount_sen).toBe(150);
  });

  it("modifier-aware with zero upcharges everywhere → 0 (still 'applied')", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_upgrade" }),
      cart: [line({ modifier_total_sen: 0 })],
    });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(0);
  });

  it("LEGACY fallback: no modifier_total_sen supplied → behaves like free_item", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "free_upgrade" }),
      cart: [line({ unit_price_sen: 1500, modifier_total_sen: undefined })],
    });
    expect(r.discount_sen).toBe(1500);
  });
});

describe("bogo — same item", () => {
  it("buy-1-get-1 over 2 units frees one", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "bogo" }),
      cart: [line({ quantity: 2, unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(1500);
  });

  it("3 units is still one complete group (floor(3/2) = 1 free)", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "bogo" }),
      cart: [line({ quantity: 3, unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(1500);
  });

  it("complete groups stack: 4 units → 2 free", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "bogo" }),
      cart: [line({ quantity: 4, unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(3000);
  });

  it("frees the CHEAPEST units across mixed prices", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "bogo" }),
      cart: [
        line({ unit_price_sen: 1800, product_id: "p-mocha", name: "Mocha" }),
        line({ unit_price_sen: 1200, product_id: "p-kopi", name: "Kopi" }),
      ],
    });
    expect(r.discount_sen).toBe(1200);
  });

  it("buy-2-get-1: 3 units → cheapest freed; 2 units → nothing", () => {
    const s = spec({ discount_type: "bogo", bogo_buy_qty: 2, bogo_free_qty: 1 });
    expect(
      computeVoucherDiscount({ spec: s, cart: [line({ quantity: 3, unit_price_sen: 1000 })] }).discount_sen,
    ).toBe(1000);
    expect(
      computeVoucherDiscount({ spec: s, cart: [line({ quantity: 2, unit_price_sen: 1000 })] }).discount_sen,
    ).toBe(0);
  });
});

describe("bogo — cross item (free_product_ids set)", () => {
  const crossSpec = spec({
    discount_type: "bogo",
    applicable_products: ["p-latte"],
    free_product_ids: ["p-croissant"],
  });

  it("buy latte → croissant in cart is freed", () => {
    const r = computeVoucherDiscount({
      spec: crossSpec,
      cart: [line(), line({ product_id: "p-croissant", name: "Croissant", category: "pastry", unit_price_sen: 800 })],
    });
    expect(r.discount_sen).toBe(800);
  });

  it("free item missing from cart → applied with 0 (nothing to free)", () => {
    const r = computeVoucherDiscount({ spec: crossSpec, cart: [line()] });
    expect(r.reason).toBe("applied");
    expect(r.discount_sen).toBe(0);
  });

  it("the free item itself never counts as a qualifying purchase", () => {
    const r = computeVoucherDiscount({
      spec: crossSpec,
      cart: [line({ product_id: "p-croissant", name: "Croissant", category: "pastry", unit_price_sen: 800 })],
    });
    expect(r.discount_sen).toBe(0);
  });

  it("no applicable filter → any non-free item qualifies as the buy", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "bogo", free_product_ids: ["p-croissant"] }),
      cart: [
        line({ product_id: "p-cake", name: "Cake", unit_price_sen: 1600 }),
        line({ product_id: "p-croissant", name: "Croissant", unit_price_sen: 800 }),
      ],
    });
    expect(r.discount_sen).toBe(800);
  });

  it("allowance scales with buy quantity and is capped by free units in cart", () => {
    const r = computeVoucherDiscount({
      spec: crossSpec,
      cart: [
        line({ quantity: 3 }), // 3 qualifying buys → allowance 3
        line({ product_id: "p-croissant", name: "Croissant", quantity: 2, unit_price_sen: 800 }),
      ],
    });
    expect(r.discount_sen).toBe(1600); // only 2 croissants exist to free
  });
});

describe("combo", () => {
  const comboSpec = spec({
    discount_type: "combo",
    applicable_products: ["p-latte", "p-croissant"],
    combo_price_sen: 1800,
  });

  it("bundle present → cheapest unit of each required, repriced to combo total", () => {
    const r = computeVoucherDiscount({
      spec: comboSpec,
      cart: [
        line({ unit_price_sen: 1500 }),
        line({ product_id: "p-croissant", name: "Croissant", unit_price_sen: 800 }),
      ],
    });
    expect(r.discount_sen).toBe(500); // (1500 + 800) - 1800
  });

  it("a required product missing → no_eligible_items", () => {
    const r = computeVoucherDiscount({ spec: comboSpec, cart: [line()] });
    expect(r.reason).toBe("no_eligible_items");
  });

  it("combo price above bundle value → 0, never negative", () => {
    const r = computeVoucherDiscount({
      spec: spec({ ...comboSpec, combo_price_sen: 9999 }),
      cart: [
        line({ unit_price_sen: 1500 }),
        line({ product_id: "p-croissant", name: "Croissant", unit_price_sen: 800 }),
      ],
    });
    expect(r.discount_sen).toBe(0);
  });

  it("missing combo_price_sen or empty required set → unsupported_discount_type", () => {
    expect(
      computeVoucherDiscount({
        spec: spec({ discount_type: "combo", applicable_products: ["p-latte"], combo_price_sen: null }),
        cart: [line()],
      }).reason,
    ).toBe("unsupported_discount_type");
    expect(
      computeVoucherDiscount({
        spec: spec({ discount_type: "combo", applicable_products: [], combo_price_sen: 1800 }),
        cart: [line()],
      }).reason,
    ).toBe("unsupported_discount_type");
  });
});

describe("override_price", () => {
  it("reprices the CHEAPEST eligible unit (conservative)", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "override_price", override_price_sen: 990 }),
      cart: [
        line({ unit_price_sen: 1800, product_id: "p-mocha", name: "Mocha" }),
        line({ unit_price_sen: 1500 }),
      ],
    });
    expect(r.discount_sen).toBe(510); // 1500 - 990
  });

  it("override above the item price → 0, never negative", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "override_price", override_price_sen: 2500 }),
      cart: [line({ unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(0);
  });

  it("null override_price_sen → unsupported_discount_type", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "override_price", override_price_sen: null }),
      cart: [line()],
    });
    expect(r.reason).toBe("unsupported_discount_type");
  });
});

describe("final guards", () => {
  it("discount never exceeds the cart subtotal", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: 999999 }),
      cart: [line({ unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(1500);
  });

  it("discount is never negative", () => {
    const r = computeVoucherDiscount({
      spec: spec({ discount_type: "flat", discount_value: -500 }),
      cart: [line({ unit_price_sen: 1500 })],
    });
    expect(r.discount_sen).toBe(0);
  });
});

describe("legacyDescriptorToSpec (POS vocab translation)", () => {
  const base = {
    value: 0,
    max_discount: null,
    min_order: null,
    applicable_categories: null,
    applicable_products: null,
    free_product_ids: null,
    free_product_name: null,
  };

  it("fixed_amount carries RM → converts to sen", () => {
    const s = legacyDescriptorToSpec({ ...base, type: "fixed_amount", value: 5 });
    expect(s.discount_type).toBe("flat");
    expect(s.discount_value).toBe(500);
  });

  it("percentage passes the raw percent through", () => {
    const s = legacyDescriptorToSpec({ ...base, type: "percentage", value: 15 });
    expect(s.discount_type).toBe("percent");
    expect(s.discount_value).toBe(15);
  });

  it("free_item / free_upgrade carry no discount_value", () => {
    for (const t of ["free_item", "free_upgrade"] as const) {
      const s = legacyDescriptorToSpec({ ...base, type: t, value: 7 });
      expect(s.discount_type).toBe(t);
      expect(s.discount_value).toBeNull();
    }
  });

  it("max_discount / min_order are RM → sen", () => {
    const s = legacyDescriptorToSpec({ ...base, type: "percentage", value: 10, max_discount: 4, min_order: 30 });
    expect(s.max_discount_value_sen).toBe(400);
    expect(s.min_order_value_sen).toBe(3000);
  });

  it("unknown legacy type → null discount_type (engine then reports no_discount_type)", () => {
    const s = legacyDescriptorToSpec({ ...base, type: "mystery", value: 5 });
    expect(s.discount_type).toBeNull();
  });
});
