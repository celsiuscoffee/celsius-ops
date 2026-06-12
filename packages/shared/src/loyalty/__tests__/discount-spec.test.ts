import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rowToDiscountSpec,
  inlineSpecFromIssued,
  specToRegisterDescriptor,
  buildEngineCart,
  type DiscountSpecRow,
} from "../discount-spec";

// Characterization tests for the spec projections + engine-cart builder.
// The unit semantics here (SEN passthrough, NOT ×100) fixed a real bug
// where min-order rewards required ~100× the intended minimum — these
// tests pin that down.

const fullRow: DiscountSpecRow = {
  discount_type: "percent",
  discount_value: 15,
  max_discount_value: 400,
  min_order_value: 1500,
  applicable_categories: ["coffee"],
  applicable_products: ["p-latte"],
  free_product_ids: ["p-croissant"],
  free_product_name: "Croissant",
  bogo_buy_qty: 2,
  bogo_free_qty: 1,
  combo_price_sen: 1800,
  override_price_sen: 990,
};

describe("rowToDiscountSpec", () => {
  it("passes money fields through as SEN — no ×100", () => {
    const s = rowToDiscountSpec(fullRow);
    expect(s.max_discount_value_sen).toBe(400);
    expect(s.min_order_value_sen).toBe(1500);
    expect(s.combo_price_sen).toBe(1800);
    expect(s.override_price_sen).toBe(990);
  });

  it("coerces stringy min_order_value via Number()", () => {
    const s = rowToDiscountSpec({ ...fullRow, min_order_value: "1500" as unknown as number });
    expect(s.min_order_value_sen).toBe(1500);
  });

  it("null min_order stays null (no minimum)", () => {
    const s = rowToDiscountSpec({ ...fullRow, min_order_value: null });
    expect(s.min_order_value_sen).toBeNull();
  });
});

describe("inlineSpecFromIssued", () => {
  it("template-only mechanics are null (legacy vouchers can't BOGO/combo/cap)", () => {
    const s = inlineSpecFromIssued({
      discount_type: "flat",
      discount_value: 500,
      min_order_value: 1500,
      applicable_categories: null,
      applicable_products: null,
      free_product_name: null,
    });
    expect(s.discount_type).toBe("flat");
    expect(s.discount_value).toBe(500);
    expect(s.min_order_value_sen).toBe(1500);
    expect(s.max_discount_value_sen).toBeNull();
    expect(s.free_product_ids).toBeNull();
    expect(s.bogo_buy_qty).toBeNull();
    expect(s.combo_price_sen).toBeNull();
    expect(s.override_price_sen).toBeNull();
  });
});

describe("specToRegisterDescriptor", () => {
  it("is unit-preserving (SEN stays SEN) and lossless for mechanics", () => {
    const d = specToRegisterDescriptor(rowToDiscountSpec(fullRow));
    expect(d.type).toBe("percent");
    expect(d.value).toBe(15);
    expect(d.max_discount).toBe(400);
    expect(d.min_order).toBe(1500);
    expect(d.bogo_buy_qty).toBe(2);
    expect(d.bogo_free_qty).toBe(1);
    expect(d.combo_price_sen).toBe(1800);
    expect(d.override_price_sen).toBe(990);
  });

  it("coalesces 0 → null for max_discount / min_order ('no cap / no minimum')", () => {
    const d = specToRegisterDescriptor(
      rowToDiscountSpec({ ...fullRow, max_discount_value: 0, min_order_value: 0 }),
    );
    expect(d.max_discount).toBeNull();
    expect(d.min_order).toBeNull();
  });

  it("null discount_value → value 0", () => {
    const d = specToRegisterDescriptor(rowToDiscountSpec({ ...fullRow, discount_value: null }));
    expect(d.value).toBe(0);
  });
});

// ── buildEngineCart ──────────────────────────────────────────────────

/** Stub supabase that only answers products-by-id lookups; throws on
 *  anything else so tests prove when the DB is (not) touched. */
function productsStub(categories: Record<string, string | null>): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "products") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              return Promise.resolve({
                data: ids.map((id) => ({ id, category: categories[id] ?? null })),
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const throwingStub = {
  from() {
    throw new Error("buildEngineCart must not query when resolveCategories=false");
  },
} as unknown as SupabaseClient;

describe("buildEngineCart", () => {
  it("splits base price (RM) vs modifier upcharge into sen", async () => {
    // 2 × latte at RM12 base, RM13.50 effective (oat milk +1.50).
    const cart = await buildEngineCart(
      throwingStub,
      [{ product: { id: "p-latte", name: "Latte" }, quantity: 2, basePrice: 12, totalPrice: 27 }],
      false,
    );
    expect(cart).toEqual([
      {
        product_id: "p-latte",
        quantity: 2,
        unit_price_sen: 1200,
        modifier_total_sen: 150,
        category: null,
        category_id: null,
        name: "Latte",
      },
    ]);
  });

  it("falls back to effective per-unit price when basePrice is absent", async () => {
    const cart = await buildEngineCart(
      throwingStub,
      [{ productId: "p-kopi", quantity: 2, totalPrice: 9 }],
      false,
    );
    expect(cart[0].unit_price_sen).toBe(450);
    expect(cart[0].modifier_total_sen).toBe(0);
  });

  it("modifier upcharge never goes negative (basePrice above effective)", async () => {
    const cart = await buildEngineCart(
      throwingStub,
      [{ product_id: "p-kopi", quantity: 1, basePrice: 10, totalPrice: 9 }],
      false,
    );
    expect(cart[0].modifier_total_sen).toBe(0);
  });

  it("guards quantity to a minimum of 1", async () => {
    const cart = await buildEngineCart(
      throwingStub,
      [{ product_id: "p-kopi", quantity: 0, totalPrice: 9 }],
      false,
    );
    expect(cart[0].quantity).toBe(1);
  });

  it("resolves categories from the products table only when asked", async () => {
    const cart = await buildEngineCart(
      productsStub({ "p-latte": "coffee" }),
      [{ product: { id: "p-latte", name: "Latte" }, quantity: 1, totalPrice: 15 }],
      true,
    );
    expect(cart[0].category).toBe("coffee");
  });

  it("accepts all three product-id field conventions", async () => {
    const cart = await buildEngineCart(
      throwingStub,
      [
        { product: { id: "a" }, quantity: 1, totalPrice: 1 },
        { productId: "b", quantity: 1, totalPrice: 1 },
        { product_id: "c", quantity: 1, totalPrice: 1 },
      ],
      false,
    );
    expect(cart.map((l) => l.product_id)).toEqual(["a", "b", "c"]);
  });
});
