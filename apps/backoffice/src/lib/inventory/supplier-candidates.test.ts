import { describe, it, expect } from "vitest";
import { isPriceSourceCandidate } from "./supplier-candidates";

const good = {
  price: 45,
  isActive: true,
  productPackageId: "pkg1",
  productPackage: { conversionFactor: 1000 },
  supplier: { status: "ACTIVE", supplierCode: "SUP-0001" },
};

describe("isPriceSourceCandidate", () => {
  it("accepts a priced, packaged row from an active non-ADHOC supplier", () => {
    expect(isPriceSourceCandidate(good)).toBe(true);
  });
  it("rejects RM0 and negative prices", () => {
    expect(isPriceSourceCandidate({ ...good, price: 0 })).toBe(false);
    expect(isPriceSourceCandidate({ ...good, price: "0.00" })).toBe(false);
    expect(isPriceSourceCandidate({ ...good, price: -1 })).toBe(false);
  });
  it("rejects the ADHOC placeholder supplier even when priced", () => {
    expect(isPriceSourceCandidate({ ...good, supplier: { status: "ACTIVE", supplierCode: "ADHOC" } })).toBe(false);
  });
  it("rejects inactive suppliers and inactive rows", () => {
    expect(isPriceSourceCandidate({ ...good, supplier: { status: "INACTIVE", supplierCode: "S" } })).toBe(false);
    expect(isPriceSourceCandidate({ ...good, isActive: false })).toBe(false);
    expect(isPriceSourceCandidate({ ...good, supplier: null })).toBe(false);
  });
  it("rejects rows with no package (no unit basis) or a zero conversion factor", () => {
    expect(isPriceSourceCandidate({ ...good, productPackage: null, productPackageId: null })).toBe(false);
    expect(isPriceSourceCandidate({ ...good, productPackage: { conversionFactor: 0 } })).toBe(false);
  });
  it("accepts Decimal-like price objects", () => {
    expect(isPriceSourceCandidate({ ...good, price: { toString: () => "12.50" } })).toBe(true);
  });
});
