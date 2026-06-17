import { describe, it, expect } from "vitest";
import { formatGrabItemPrice } from "./grab-item-links";

describe("formatGrabItemPrice", () => {
  it("shows a single price when min and max agree", () => {
    expect(formatGrabItemPrice(16.87, 16.87)).toBe("RM 16.87");
  });

  it("shows a range when prices differ", () => {
    expect(formatGrabItemPrice(13.87, 16.87)).toBe("RM 13.87–RM 16.87");
  });

  it("handles a single populated bound", () => {
    expect(formatGrabItemPrice(15.9, null)).toBe("RM 15.90");
    expect(formatGrabItemPrice(null, 9.87)).toBe("RM 9.87");
  });

  it("falls back to a dash when both are null", () => {
    expect(formatGrabItemPrice(null, null)).toBe("—");
  });
});
