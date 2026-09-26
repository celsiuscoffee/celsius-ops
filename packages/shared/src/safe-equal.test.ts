import { describe, it, expect } from "vitest";
import { safeEqual } from "./safe-equal";

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("Bearer abc123", "Bearer abc123")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });
  it("rejects different strings of equal and unequal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
  });
  it("rejects non-strings without throwing", () => {
    expect(safeEqual(null, "x")).toBe(false);
    expect(safeEqual("x", undefined)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });
});
