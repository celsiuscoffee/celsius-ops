import { describe, it, expect } from "vitest";
import { aggregateConsumption, channelWeight } from "./consumption";

describe("channelWeight", () => {
  it("bills every ALL line, splits dine-in/takeaway by the ratio", () => {
    expect(channelWeight("ALL")).toBe(1);
    expect(channelWeight("TAKEAWAY", 0.6)).toBe(0.6);
    expect(channelWeight("DINE_IN", 0.6)).toBeCloseTo(0.4);
  });
});

describe("aggregateConsumption", () => {
  const recipes = new Map([
    ["latte", [
      { productId: "beans", quantityUsed: 18, serviceMode: "ALL" as const },
      { productId: "milk", quantityUsed: 200, serviceMode: "ALL" as const },
      { productId: "cup", quantityUsed: 1, serviceMode: "TAKEAWAY" as const },
    ]],
    ["espresso", [
      { productId: "beans", quantityUsed: 18, serviceMode: "ALL" as const },
    ]],
  ]);

  it("multiplies sales by recipe qty and sums per ingredient", () => {
    const sales = new Map([["latte", 10], ["espresso", 5]]);
    const c = aggregateConsumption(sales, recipes, 0.5);
    expect(c.get("beans")).toBe(18 * 10 + 18 * 5); // 270 g
    expect(c.get("milk")).toBe(200 * 10); // 2000 ml
    expect(c.get("cup")).toBe(1 * 10 * 0.5); // takeaway-weighted → 5
  });

  it("skips menus with no recipe and ignores zero/negative sales", () => {
    const sales = new Map([["latte", 0], ["unknown-menu", 100]]);
    const c = aggregateConsumption(sales, recipes);
    expect(c.size).toBe(0);
  });
});
