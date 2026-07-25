import { describe, expect, it } from "vitest";
import { normaliseItems } from "@/app/api/inventory/prep-recipes/route";

// The prep-recipe input lines carry the whole batch cost, so a bad line is a
// silently wrong cost-per-prepped-unit (and therefore a wrong stock valuation)
// rather than a visible error. These guard the validation that keeps that out.
describe("normaliseItems", () => {
  it("accepts a clean set of input lines", () => {
    const r = normaliseItems([
      { productId: "raw-chicken", quantityUsed: 10000, uom: "g" },
      { productId: "marinade", quantityUsed: 250, uom: "g" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.items[0]).toEqual({ productId: "raw-chicken", quantityUsed: 10000, uom: "g" });
    }
  });

  it("rejects an empty or non-array list", () => {
    expect(normaliseItems([]).ok).toBe(false);
    expect(normaliseItems(undefined).ok).toBe(false);
    expect(normaliseItems("nope").ok).toBe(false);
  });

  it("rejects a duplicated input product", () => {
    // The DB has a unique (recipeId, productId); catching it here turns a
    // P2002 500 into a readable message.
    const r = normaliseItems([
      { productId: "raw-chicken", quantityUsed: 5000, uom: "g" },
      { productId: "raw-chicken", quantityUsed: 5000, uom: "g" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/twice/i);
  });

  it("rejects zero, negative and non-numeric quantities", () => {
    // A zero-quantity line would contribute nothing and quietly understate the
    // batch cost — worse than refusing the save.
    for (const bad of [0, -5, "abc", null, undefined, NaN]) {
      const r = normaliseItems([{ productId: "raw-chicken", quantityUsed: bad, uom: "g" }]);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a line with no product", () => {
    expect(normaliseItems([{ quantityUsed: 100, uom: "g" }]).ok).toBe(false);
    expect(normaliseItems([{ productId: "", quantityUsed: 100, uom: "g" }]).ok).toBe(false);
  });

  it("coerces numeric strings and defaults a missing uom", () => {
    const r = normaliseItems([{ productId: "raw-chicken", quantityUsed: "2500" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0].quantityUsed).toBe(2500);
      expect(r.items[0].uom).toBe("");
    }
  });
});
