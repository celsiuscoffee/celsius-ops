import { describe, it, expect } from "vitest";
import {
  toServiceMode,
  ruleAppliesToChannel,
  expandPackagingForLine,
  expandPerOrderPackaging,
  type PackagingRuleLite,
  type SoldLine,
} from "./report-sales";

const CUP: PackagingRuleLite = { productId: "cup", quantity: 1, scope: "ITEMS", category: null, menuIds: ["latte"], channel: "TAKEAWAY", modifier: "Iced", perOrder: false };
const STRAW: PackagingRuleLite = { productId: "straw", quantity: 1, scope: "ALL", category: null, menuIds: [], channel: "ALL", modifier: "Iced", perOrder: false };
const NAPKIN: PackagingRuleLite = { productId: "napkin", quantity: 2, scope: "CATEGORY", category: "Pasta", menuIds: [], channel: "DINE_IN", modifier: null, perOrder: false };
const BAG: PackagingRuleLite = { productId: "bag", quantity: 1, scope: "ALL", category: null, menuIds: [], channel: "GRAB", modifier: null, perOrder: true };
const RULES = [CUP, STRAW, NAPKIN, BAG];

const latte = { id: "latte", category: "Classic" };
const pasta = { id: "carbo", category: "Pasta" };

function line(over: Partial<SoldLine>): SoldLine {
  return { outletId: "o1", orderId: "ord", menuId: "latte", productName: "Latte", qty: 1, revenue: 11.9, modifiers: null, orderType: "dine_in", source: "pos", ...over };
}

describe("toServiceMode", () => {
  it("maps POS/app order types and treats Grab as takeaway", () => {
    expect(toServiceMode({ orderType: "dine_in", source: "pos" })).toBe("DINE_IN");
    expect(toServiceMode({ orderType: "takeaway", source: "pos" })).toBe("TAKEAWAY");
    expect(toServiceMode({ orderType: "pickup", source: "app_ios" })).toBe("TAKEAWAY");
    expect(toServiceMode({ orderType: "dine_in", source: "web_qr" })).toBe("DINE_IN");
    expect(toServiceMode({ orderType: "takeaway", source: "grabfood" })).toBe("TAKEAWAY");
    expect(toServiceMode({ orderType: null, source: null })).toBeNull();
  });
});

describe("ruleAppliesToChannel", () => {
  it("GRAB rules fire only for Grab; TAKEAWAY rules also cover Grab lines", () => {
    const grab = { orderType: "takeaway", source: "grabfood" };
    const counterTakeaway = { orderType: "takeaway", source: "pos" };
    expect(ruleAppliesToChannel(BAG, grab)).toBe(true);
    expect(ruleAppliesToChannel(BAG, counterTakeaway)).toBe(false);
    expect(ruleAppliesToChannel(CUP, grab)).toBe(true);
    expect(ruleAppliesToChannel(NAPKIN, grab)).toBe(false);
  });
});

describe("expandPackagingForLine", () => {
  it("iced takeaway latte gets cup + straw; hot dine-in latte gets nothing", () => {
    const iced = expandPackagingForLine(line({ orderType: "takeaway", modifiers: [{ name: "Iced" }], qty: 2 }), latte, RULES);
    expect(iced.get("cup")).toBe(2);
    expect(iced.get("straw")).toBe(2);
    expect(iced.has("napkin")).toBe(false);

    const hot = expandPackagingForLine(line({ modifiers: [{ name: "Hot" }] }), latte, RULES);
    expect(hot.size).toBe(0);
  });

  it("reads the customer-app modifier shape too, and never applies per-order rules per line", () => {
    const app = expandPackagingForLine(
      line({ orderType: "pickup", source: "app_ios", modifiers: { selections: [{ label: "Iced", groupName: "Temperature" }] } }),
      latte, RULES,
    );
    expect(app.get("cup")).toBe(1);
    expect(app.has("bag")).toBe(false);
  });

  it("category-scoped dine-in rule fires for the category only", () => {
    expect(expandPackagingForLine(line({ menuId: "carbo" }), pasta, RULES).get("napkin")).toBe(2);
    expect(expandPackagingForLine(line({}), latte, RULES).has("napkin")).toBe(false);
  });
});

describe("expandPerOrderPackaging", () => {
  it("charges one bag per Grab order regardless of line count", () => {
    const menuById = new Map([["latte", latte], ["carbo", pasta]]);
    const lines = [
      line({ orderId: "g1", source: "grabfood", orderType: "takeaway" }),
      line({ orderId: "g1", source: "grabfood", orderType: "takeaway", menuId: "carbo" }),
      line({ orderId: "g2", source: "grabfood", orderType: "takeaway" }),
      line({ orderId: "c1", source: "pos", orderType: "takeaway" }),
    ];
    expect(expandPerOrderPackaging(lines, menuById, RULES).get("bag")).toBe(2);
  });
});
