import { describe, it, expect } from "vitest";
import { parseMoqRm, nextDeliveryDate, validateSupplierOrder } from "./order-validation";

// A UTC-midnight Date for a given YYYY-MM-DD (what callers pass as "today"/planned).
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("parseMoqRm", () => {
  it("reads RM-prefixed amounts", () => {
    expect(parseMoqRm("RM300")).toBe(300);
    expect(parseMoqRm("rm 1,000")).toBe(1000);
    expect(parseMoqRm("trip min RM500")).toBe(500);
    expect(parseMoqRm("RM250.50")).toBe(250.5);
  });

  it("falls back to a bare number", () => {
    expect(parseMoqRm("250")).toBe(250);
    expect(parseMoqRm("min order 400")).toBe(400);
  });

  it("returns null when there is no number", () => {
    expect(parseMoqRm("")).toBeNull();
    expect(parseMoqRm(null)).toBeNull();
    expect(parseMoqRm(undefined)).toBeNull();
    expect(parseMoqRm("by arrangement")).toBeNull();
  });
});

describe("nextDeliveryDate", () => {
  it("finds the next configured delivery day after lead time", () => {
    // 2026-06-26 is a Friday. Supplier delivers Tue/Thu, lead time 1 day.
    // From Fri + 1 = Sat 27th → next Tue/Thu is Tue 30th.
    const next = nextDeliveryDate(["Tuesday", "Thursday"], 1, d("2026-06-26"));
    expect(next && next.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("accepts 3-letter prefixes and is case-insensitive", () => {
    const next = nextDeliveryDate(["mon", "WED"], 0, d("2026-06-26")); // Fri → next Mon 29th
    expect(next && next.toISOString().slice(0, 10)).toBe("2026-06-29");
  });

  it("returns null with no delivery days", () => {
    expect(nextDeliveryDate([], 1, d("2026-06-26"))).toBeNull();
  });
});

describe("validateSupplierOrder", () => {
  it("warns when below trip MOQ with the exact shortfall", () => {
    const w = validateSupplierOrder({ orderTotal: 180, moq: "RM300", deliveryDays: [] });
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe("BELOW_MOQ");
    expect(w[0].meta?.shortfall).toBe(120);
  });

  it("is silent at or above MOQ", () => {
    const w = validateSupplierOrder({ orderTotal: 300, moq: "RM300", deliveryDays: [] });
    expect(w).toHaveLength(0);
  });

  it("warns when the planned delivery date isn't a delivery day", () => {
    // Planned Wed 2026-07-01, but supplier only delivers Tue/Thu.
    const w = validateSupplierOrder({
      orderTotal: 500,
      moq: "RM300",
      deliveryDays: ["Tuesday", "Thursday"],
      deliveryDate: d("2026-07-01"),
    });
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe("DELIVERY_DAY");
    expect(w[0].meta?.suggested).toBe("2026-07-02"); // next Thursday on/after the plan
  });

  it("does not warn when the planned date is a valid delivery day", () => {
    const w = validateSupplierOrder({
      orderTotal: 500,
      moq: "RM300",
      deliveryDays: ["Tuesday", "Thursday"],
      deliveryDate: d("2026-07-02"), // Thursday
    });
    expect(w).toHaveLength(0);
  });
});
