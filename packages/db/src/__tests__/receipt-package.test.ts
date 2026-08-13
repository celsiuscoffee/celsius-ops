import { describe, it, expect } from "vitest";
import {
  resolveReceiptPackage,
  resolveReceiptPackages,
  type ProductPackageOption,
  type ResolveReceiptPackageContext,
} from "../receipt-package";

const MILK = "prod-milk";
const BRIOCHE = "prod-brioche";
const HERBS = "prod-herbs";

// Fresh Milk as actually defined: six packages spanning ×1,000 to ×24,000.
// This is the product whose package-less receipts were booked as millilitres.
const MILK_PACKAGES: ProductPackageOption[] = [
  { id: "pk-milk-1l", productId: MILK, packageLabel: "Bottle (1,000ml)", conversionFactor: 1000 },
  { id: "pk-milk-2l", productId: MILK, packageLabel: "2,000ml Bottle", conversionFactor: 2000 },
  { id: "pk-milk-ctn12x1", productId: MILK, packageLabel: "Carton (12× 1,000ml Bottle)", conversionFactor: 12000 },
  { id: "pk-milk-ctn12x2", productId: MILK, packageLabel: "Carton (12× 2,000ml Bottle)", conversionFactor: 24000 },
];

const BRIOCHE_PACKAGES: ProductPackageOption[] = [
  { id: "pk-brioche-loaf", productId: BRIOCHE, packageLabel: "10pcs Loaf", conversionFactor: 10 },
  { id: "pk-brioche-box", productId: BRIOCHE, packageLabel: "Box (10× 10pcs Loaf)", conversionFactor: 100 },
];

const ALL: ProductPackageOption[] = [...MILK_PACKAGES, ...BRIOCHE_PACKAGES];

const ctx = (over: Partial<ResolveReceiptPackageContext> = {}): ResolveReceiptPackageContext => ({
  packages: ALL,
  productNames: new Map([
    [MILK, "Fresh Milk"],
    [BRIOCHE, "Brioche Loaf"],
    [HERBS, "Daun Pandan"],
  ]),
  ...over,
});

describe("resolveReceiptPackage — precedence", () => {
  it("uses the package the receiver named", () => {
    const r = resolveReceiptPackage({ productId: MILK, productPackageId: "pk-milk-ctn12x2" }, ctx());
    expect(r).toMatchObject({ ok: true, conversionFactor: 24000, source: "explicit" });
  });

  it("falls back to the PO line — goods arrive in the unit they were ordered in", () => {
    const r = resolveReceiptPackage(
      { productId: MILK },
      ctx({ poPackageByProduct: new Map([[MILK, "pk-milk-ctn12x1"]]) }),
    );
    expect(r).toMatchObject({ ok: true, conversionFactor: 12000, source: "purchase-order" });
  });

  it("prefers the receiver's choice over the PO's", () => {
    // A short/substituted delivery can genuinely arrive in a different pack.
    const r = resolveReceiptPackage(
      { productId: MILK, productPackageId: "pk-milk-1l" },
      ctx({ poPackageByProduct: new Map([[MILK, "pk-milk-ctn12x2"]]) }),
    );
    expect(r).toMatchObject({ ok: true, productPackageId: "pk-milk-1l", source: "explicit" });
  });

  it("takes the sole package when the product defines exactly one", () => {
    const r = resolveReceiptPackage({ productId: HERBS }, ctx({
      packages: [{ id: "pk-herbs-kg", productId: HERBS, packageLabel: "Kilogram (1000g)", conversionFactor: 1000 }],
    }));
    expect(r).toMatchObject({ ok: true, conversionFactor: 1000, source: "sole-package" });
  });

  it("allows base UOM when the product defines no packages at all", () => {
    const r = resolveReceiptPackage({ productId: HERBS }, ctx({ packages: [] }));
    expect(r).toMatchObject({ ok: true, productPackageId: null, conversionFactor: 1, source: "base-uom" });
  });
});

describe("resolveReceiptPackage — the guard", () => {
  it("REFUSES to guess when several packages are defined and none was chosen", () => {
    // The bug this exists for: factor 1 booked "5 cartons" of milk as 5 ml.
    const r = resolveReceiptPackage({ productId: MILK }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("AMBIGUOUS_PACKAGE");
  });

  it("names the product and lists the options so the receiver can fix it", () => {
    const r = resolveReceiptPackage({ productId: BRIOCHE }, ctx());
    if (r.ok) throw new Error("expected rejection");
    expect(r.message).toContain("Brioche Loaf");
    expect(r.message).toContain("10pcs Loaf (×10)");
    expect(r.message).toContain("Box (10× 10pcs Loaf) (×100)");
  });

  it("never silently returns factor 1 for an ambiguous line", () => {
    // Regression: the old fallback returned 1 here, which is how 23% of
    // receipts since June were stored in base UOM by accident.
    for (const productId of [MILK, BRIOCHE]) {
      const r = resolveReceiptPackage({ productId }, ctx());
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a package belonging to a different product", () => {
    // Accepting it would apply the other product's conversion factor.
    const r = resolveReceiptPackage({ productId: MILK, productPackageId: "pk-brioche-box" }, ctx());
    if (r.ok) throw new Error("expected rejection");
    expect(r.reason).toBe("UNKNOWN_PACKAGE");
  });

  it("rejects a package whose conversion factor is unusable", () => {
    for (const cf of [0, -5, Number.NaN, "abc"]) {
      const r = resolveReceiptPackage({ productId: HERBS, productPackageId: "pk-bad" }, ctx({
        packages: [{ id: "pk-bad", productId: HERBS, packageLabel: "Broken", conversionFactor: cf as number }],
      }));
      expect(r.ok).toBe(false);
    }
  });

  it("does not let a PO package for another product leak in", () => {
    const r = resolveReceiptPackage(
      { productId: MILK },
      ctx({ poPackageByProduct: new Map([[BRIOCHE, "pk-brioche-box"]]) }),
    );
    expect(r.ok).toBe(false); // milk still ambiguous; brioche's PO package is irrelevant
  });
});

describe("resolveReceiptPackage — factors as Decimal-like strings", () => {
  it("accepts the string form Prisma Decimal serialises to", () => {
    const r = resolveReceiptPackage({ productId: HERBS, productPackageId: "pk-s" }, ctx({
      packages: [{ id: "pk-s", productId: HERBS, packageLabel: "Kg", conversionFactor: "1000.000000000000000000" }],
    }));
    expect(r).toMatchObject({ ok: true, conversionFactor: 1000 });
  });
});

describe("resolveReceiptPackages — all or nothing", () => {
  it("resolves a whole receipt when every line is determined", () => {
    const r = resolveReceiptPackages(
      [
        { productId: MILK, productPackageId: "pk-milk-1l" },
        { productId: BRIOCHE },
      ],
      ctx({ poPackageByProduct: new Map([[BRIOCHE, "pk-brioche-box"]]) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.resolved.map((x) => x.conversionFactor)).toEqual([1000, 100]);
  });

  it("rejects the ENTIRE receipt if any line is ambiguous", () => {
    // Booking half a delivery leaves stock in a state nobody can reason about.
    const r = resolveReceiptPackages(
      [{ productId: MILK, productPackageId: "pk-milk-1l" }, { productId: BRIOCHE }],
      ctx(),
    );
    expect(r.ok).toBe(false);
  });

  it("returns every bad line at once, not just the first", () => {
    const r = resolveReceiptPackages([{ productId: MILK }, { productId: BRIOCHE }], ctx());
    if (r.ok) throw new Error("expected rejection");
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map((e) => e.productId).sort()).toEqual([BRIOCHE, MILK].sort());
  });

  it("passes an empty receipt through", () => {
    expect(resolveReceiptPackages([], ctx())).toEqual({ ok: true, resolved: [] });
  });
});

describe("the discrepancy this guard closes", () => {
  it("a carton and a bare line no longer both mean 'ten'", () => {
    // Brioche Sandwich: 6 receipts stored as 10 packs (=100 pcs) and 6 stored
    // bare (=10 pcs) — same supplier, same drop, a factor of 10 apart.
    const withPkg = resolveReceiptPackage({ productId: BRIOCHE, productPackageId: "pk-brioche-loaf" }, ctx());
    const bare = resolveReceiptPackage({ productId: BRIOCHE }, ctx());
    expect(withPkg).toMatchObject({ ok: true, conversionFactor: 10 });
    expect(bare.ok).toBe(false); // previously resolved to factor 1
  });
});
