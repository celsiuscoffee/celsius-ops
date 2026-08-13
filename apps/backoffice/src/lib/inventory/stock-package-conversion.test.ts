import { describe, it, expect } from "vitest";
import { baseTotalsFromPackages } from "../stock";

// Real factors from the products involved in the 2026-08-02 Pay & Claim batch
// that exposed this bug.
const CF = new Map<string, number>([
  ["butter-250g", 250],
  ["shimeji-125g", 125],
  ["fettucine-500g", 500],
  ["straw-pack-100", 100],
]);

describe("baseTotalsFromPackages", () => {
  it("converts package units to base UOM", () => {
    // The reported bug: 2 packs of butter were booked as 2 grams, not 500.
    const totals = baseTotalsFromPackages(
      [{ productId: "butter", productPackageId: "butter-250g", quantity: 2 }],
      CF,
    );
    expect(totals.get("butter")).toBe(500);
  });

  it("sums two package sizes of the same product onto one row", () => {
    // Both must land on the single canonical balance row, not two.
    const totals = baseTotalsFromPackages(
      [
        { productId: "shimeji", productPackageId: "shimeji-125g", quantity: 10 },
        { productId: "shimeji", productPackageId: "shimeji-125g", quantity: 7 },
      ],
      CF,
    );
    expect(totals.size).toBe(1);
    expect(totals.get("shimeji")).toBe(2125);
  });

  it("treats a line with no package as already in base units", () => {
    const totals = baseTotalsFromPackages([{ productId: "ice", quantity: 5 }], CF);
    expect(totals.get("ice")).toBe(5);
  });

  it("falls back to factor 1 for an unknown or invalid package", () => {
    const bad = new Map<string, number>([["zero", 0], ["neg", -3], ["nan", NaN]]);
    for (const id of ["zero", "neg", "nan", "missing"]) {
      const totals = baseTotalsFromPackages(
        [{ productId: "p", productPackageId: id, quantity: 4 }],
        bad,
      );
      expect(totals.get("p")).toBe(4);
    }
  });

  it("carries the sign through for debits (transfer out, cancellation)", () => {
    const totals = baseTotalsFromPackages(
      [{ productId: "fettucine", productPackageId: "fettucine-500g", quantity: -3 }],
      CF,
    );
    expect(totals.get("fettucine")).toBe(-1500);
  });

  it("nets a credit and a debit on the same product", () => {
    const totals = baseTotalsFromPackages(
      [
        { productId: "straw", productPackageId: "straw-pack-100", quantity: 2 },
        { productId: "straw", productPackageId: "straw-pack-100", quantity: -1 },
      ],
      CF,
    );
    expect(totals.get("straw")).toBe(100);
  });

  it("skips a line whose quantity is not a number", () => {
    const totals = baseTotalsFromPackages(
      [{ productId: "x", productPackageId: "butter-250g", quantity: NaN }],
      CF,
    );
    expect(totals.has("x")).toBe(false);
  });
});
