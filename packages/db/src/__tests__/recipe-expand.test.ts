import { describe, it, expect } from "vitest";
import { expandSoldLine, expandSoldLines, type RecipeLine } from "../recipe-expand";

const BEANS = "prod-beans";
const MILK = "prod-milk";
const OAT = "prod-oat";
const SYRUP = "prod-syrup";
const CUP = "prod-cup";

// Caramel Latte as it is actually stored: one bean line, one milk line, and the
// syrup split across two temperature-scoped rows (17ml Iced / 8ml Hot).
const CARAMEL_LATTE: RecipeLine[] = [
  { productId: BEANS, quantityUsed: 18 },
  { productId: MILK, quantityUsed: 150 },
  { productId: SYRUP, quantityUsed: 17, modifier: "Iced" },
  { productId: SYRUP, quantityUsed: 8, modifier: "Hot" },
  { productId: CUP, quantityUsed: 1, serviceMode: "TAKEAWAY" },
  // The substitution this change exists for.
  { productId: OAT, quantityUsed: 150, modifier: "Oatmilk", replacesProductId: MILK },
];

describe("expandSoldLine — temperature scoping", () => {
  it("charges only the Iced dose on an iced drink", () => {
    const r = expandSoldLine({ units: 1, modifiers: ["Iced"] }, CARAMEL_LATTE);
    expect(r.get(SYRUP)).toBe(17);
  });

  it("charges only the Hot dose on a hot drink", () => {
    const r = expandSoldLine({ units: 1, modifiers: ["Hot"] }, CARAMEL_LATTE);
    expect(r.get(SYRUP)).toBe(8);
  });

  it("charges NEITHER dose when no temperature was recorded", () => {
    // The old behaviour summed both (17+8=25) on every sale — roughly double.
    // A scoped line with no matching modifier simply does not apply.
    const r = expandSoldLine({ units: 1, modifiers: [] }, CARAMEL_LATTE);
    expect(r.has(SYRUP)).toBe(false);
    expect(r.get(BEANS)).toBe(18);
  });

  it("never sums the two temperature rows together", () => {
    for (const mods of [["Iced"], ["Hot"], ["Iced", "Oatmilk"]]) {
      const r = expandSoldLine({ units: 1, modifiers: mods }, CARAMEL_LATTE);
      expect(r.get(SYRUP)).not.toBe(25);
    }
  });
});

describe("expandSoldLine — substitution", () => {
  it("swaps fresh milk for oat milk, billing one not both", () => {
    const r = expandSoldLine({ units: 1, modifiers: ["Iced", "Oatmilk"] }, CARAMEL_LATTE);
    expect(r.get(OAT)).toBe(150);
    expect(r.has(MILK)).toBe(false);
  });

  it("keeps fresh milk when the modifier is absent, and never charges oat", () => {
    const r = expandSoldLine({ units: 1, modifiers: ["Hot"] }, CARAMEL_LATTE);
    expect(r.get(MILK)).toBe(150);
    expect(r.has(OAT)).toBe(false);
  });

  it("leaves the rest of the recipe intact through a substitution", () => {
    // An oat drink still gets its beans and its Iced syrup dose.
    const r = expandSoldLine({ units: 1, modifiers: ["Iced", "Oatmilk"] }, CARAMEL_LATTE);
    expect(r.get(BEANS)).toBe(18);
    expect(r.get(SYRUP)).toBe(17);
  });

  it("substitutes regardless of where the line sits in the recipe", () => {
    const reordered = [...CARAMEL_LATTE].reverse();
    const r = expandSoldLine({ units: 1, modifiers: ["Oatmilk"] }, reordered);
    expect(r.get(OAT)).toBe(150);
    expect(r.has(MILK)).toBe(false);
  });
});

describe("expandSoldLine — service mode", () => {
  it("charges the takeaway cup only on takeaway", () => {
    expect(expandSoldLine({ units: 1, modifiers: ["Hot"], serviceMode: "TAKEAWAY" }, CARAMEL_LATTE).get(CUP)).toBe(1);
    expect(expandSoldLine({ units: 1, modifiers: ["Hot"], serviceMode: "DINE_IN" }, CARAMEL_LATTE).has(CUP)).toBe(false);
  });

  it("keeps channel-scoped lines when the channel is unknown", () => {
    // Dropping them would silently under-count packaging on unclassified sales.
    expect(expandSoldLine({ units: 1, modifiers: ["Hot"] }, CARAMEL_LATTE).get(CUP)).toBe(1);
  });
});

describe("expandSoldLine — quantities", () => {
  it("multiplies by units sold", () => {
    const r = expandSoldLine({ units: 3, modifiers: ["Iced"] }, CARAMEL_LATTE);
    expect(r.get(BEANS)).toBe(54);
    expect(r.get(SYRUP)).toBe(51);
  });

  it("accepts Decimal-like string quantities", () => {
    const r = expandSoldLine({ units: 2, modifiers: [] }, [{ productId: BEANS, quantityUsed: "18.5" }]);
    expect(r.get(BEANS)).toBe(37);
  });

  it("returns nothing for a menu with no recipe", () => {
    expect(expandSoldLine({ units: 5, modifiers: ["Iced"] }, []).size).toBe(0);
  });
});

describe("expandSoldLines", () => {
  it("sums across a day's sales, mixing temperatures and substitutions", () => {
    const total = expandSoldLines([
      { units: 10, modifiers: ["Iced"], recipe: CARAMEL_LATTE },
      { units: 4, modifiers: ["Hot"], recipe: CARAMEL_LATTE },
      { units: 2, modifiers: ["Iced", "Oatmilk"], recipe: CARAMEL_LATTE },
    ]);
    expect(total.get(BEANS)).toBe(16 * 18);
    expect(total.get(SYRUP)).toBe(10 * 17 + 4 * 8 + 2 * 17); // 170 + 32 + 34
    expect(total.get(MILK)).toBe(14 * 150); // the 2 oat drinks excluded
    expect(total.get(OAT)).toBe(2 * 150);
  });
});
