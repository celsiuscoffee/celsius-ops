import { describe, expect, it } from "vitest";
import { generateOrderNumber, modifierPriceMap, phoneDigits, serverModifierDeltaSen } from "./guards";

describe("phoneDigits", () => {
  it("maps every stored spelling of a Malaysian number to one form", () => {
    expect(phoneDigits("+60123456789")).toBe("60123456789");
    expect(phoneDigits("60123456789")).toBe("60123456789");
    expect(phoneDigits("0123456789")).toBe("60123456789");
    expect(phoneDigits("012-345 6789")).toBe("60123456789");
    expect(phoneDigits("123456789")).toBe("60123456789");
    expect(phoneDigits("")).toBe("");
    expect(phoneDigits(null)).toBe("");
  });
});

describe("modifier pricing", () => {
  const modifiers = [
    { id: "mg_temp", options: [{ id: "mo_hot", priceDelta: 0 }, { id: "mo_iced", priceDelta: 1 }] },
    { id: "mg_pack", options: [{ id: "mo_pack", priceDelta: 0.9 }] },
    { id: "broken" },
  ];
  const prices = modifierPriceMap(modifiers);

  it("reads option prices from the product row in sen", () => {
    expect(prices.get("mo_iced")).toBe(100);
    expect(prices.get("mo_pack")).toBe(90);
    expect(prices.get("mo_hot")).toBe(0);
    expect(modifierPriceMap(null).size).toBe(0);
    expect(modifierPriceMap("junk").size).toBe(0);
  });

  it("ignores the client's priceDelta for a known option", () => {
    // A client sending priceDelta: 0 for the +RM1 iced option pays RM1.
    expect(serverModifierDeltaSen(prices, [{ optionId: "mo_iced", priceDelta: 0 }])).toBe(100);
    expect(serverModifierDeltaSen(prices, { selections: [{ optionId: "mo_iced", priceDelta: -5 }] })).toBe(100);
    // ...and can't inflate it either.
    expect(serverModifierDeltaSen(prices, [{ optionId: "mo_hot", priceDelta: 9 }])).toBe(0);
  });

  it("clamps an unknown option to the client's non-negative value", () => {
    expect(serverModifierDeltaSen(prices, [{ optionId: "legacy", priceDelta: 0.5 }])).toBe(50);
    expect(serverModifierDeltaSen(prices, [{ optionId: "legacy", priceDelta: -2 }])).toBe(0);
    expect(serverModifierDeltaSen(prices, [{ priceDelta: "abc" }])).toBe(0);
    expect(serverModifierDeltaSen(prices, undefined)).toBe(0);
  });

  it("sums across selections", () => {
    expect(
      serverModifierDeltaSen(prices, [
        { optionId: "mo_iced", priceDelta: 0 },
        { optionId: "mo_pack", priceDelta: 0 },
      ]),
    ).toBe(190);
  });
});

describe("generateOrderNumber", () => {
  it("produces C- + 6 uppercase alphanumerics", () => {
    for (let i = 0; i < 50; i++) expect(generateOrderNumber()).toMatch(/^C-[0-9A-Z]{6}$/);
  });
});
