/**
 * Decide which package a received line arrived in — or refuse to guess.
 *
 * StockBalance is kept in base UOM, so every receipt is multiplied by its
 * package's conversionFactor before it lands. When no package is recorded the
 * write paths fell back to factor 1, i.e. "assume the quantity is already in
 * base units". That fallback is a guess, and it is wrong by the size of the
 * package every time the receiver meant "5 cartons".
 *
 * Measured 2026-08-12: 357 of 1,541 ReceivingItems since June (23%) carry no
 * package. Brioche Sandwich is the clean demonstration — 6 receipts recorded as
 * `10pcs Loaf` (=100 pcs) and 6 recorded bare (=10 pcs), same supplier, same
 * drop size, a factor of 10 apart in the ledger. Fresh Milk is the worst: 6
 * different receiving packages spanning ×1,000 to ×24,000, and 25 bare receipts
 * booked as millilitres. Counts, by contrast, are clean — one package per
 * product, no nulls — so the two sides of every reconciliation were denominated
 * differently and nothing could ever tie out.
 *
 * The guard is deliberately narrow. Refusing every package-less line would
 * block legitimate receiving; refusing none is the status quo. So it resolves
 * wherever the answer is *determined* and rejects only where it is genuinely
 * ambiguous. Against the same 357 rows: 334 resolve from the PO line (the data
 * was already in the database — the routes simply didn't persist it), 13 resolve
 * because the product has exactly one package, and 10 are ambiguous. Ten blocked
 * lines in two and a half months is a cost worth paying.
 */

export type ReceiptPackageSource =
  /** The client named a package explicitly. */
  | "explicit"
  /** Taken from the matching purchase-order line — goods arrive in PO units. */
  | "purchase-order"
  /** The product defines exactly one package, so there is nothing to choose. */
  | "sole-package"
  /** The product defines no packages at all; base UOM is the only reading. */
  | "base-uom";

export interface ResolvedReceiptPackage {
  ok: true;
  productPackageId: string | null;
  /** Base-UOM units per package. Always > 0; 1 when the line is in base UOM. */
  conversionFactor: number;
  source: ReceiptPackageSource;
}

export interface RejectedReceiptPackage {
  ok: false;
  productId: string;
  reason: "AMBIGUOUS_PACKAGE" | "UNKNOWN_PACKAGE";
  message: string;
}

export type ReceiptPackageResult = ResolvedReceiptPackage | RejectedReceiptPackage;

export interface ReceiptLine {
  productId: string;
  productPackageId?: string | null;
}

export interface ProductPackageOption {
  id: string;
  productId: string;
  packageLabel: string;
  conversionFactor: number | string;
}

export interface ResolveReceiptPackageContext {
  /** Every package defined for the products in this receipt. */
  packages: ProductPackageOption[];
  /**
   * Package chosen on the purchase-order line, keyed by productId. Goods are
   * delivered in the unit they were ordered in, so this is a fact about the
   * delivery rather than an inference about it.
   */
  poPackageByProduct?: Map<string, string | null>;
  /** Product names for readable errors; falls back to the id. */
  productNames?: Map<string, string>;
}

function toFactor(v: number | string): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve one received line to a package + conversion factor.
 *
 * Precedence is strongest-evidence-first: what the receiver said, then what the
 * PO says, then the product's own definitions. A package id that does not belong
 * to the line's product is rejected rather than silently ignored — accepting it
 * would apply another product's conversion factor.
 */
export function resolveReceiptPackage(
  line: ReceiptLine,
  ctx: ResolveReceiptPackageContext,
): ReceiptPackageResult {
  const forProduct = ctx.packages.filter((p) => p.productId === line.productId);
  const byId = new Map(forProduct.map((p) => [p.id, p]));
  const name = ctx.productNames?.get(line.productId) ?? line.productId;

  const take = (id: string, source: ReceiptPackageSource): ReceiptPackageResult => {
    const pkg = byId.get(id);
    if (!pkg) {
      return {
        ok: false,
        productId: line.productId,
        reason: "UNKNOWN_PACKAGE",
        message: `${name}: package ${id} is not defined for this product.`,
      };
    }
    const factor = toFactor(pkg.conversionFactor);
    if (factor === null) {
      return {
        ok: false,
        productId: line.productId,
        reason: "UNKNOWN_PACKAGE",
        message: `${name}: package "${pkg.packageLabel}" has no usable conversion factor.`,
      };
    }
    return { ok: true, productPackageId: pkg.id, conversionFactor: factor, source };
  };

  // 1. The receiver named one.
  if (line.productPackageId) return take(line.productPackageId, "explicit");

  // 2. The PO line names one — goods arrive in the unit they were ordered in.
  const poPkgId = ctx.poPackageByProduct?.get(line.productId) ?? null;
  if (poPkgId) return take(poPkgId, "purchase-order");

  // 3. The product defines no packages: base UOM is the only possible reading,
  //    so factor 1 is a fact here rather than the old blanket assumption.
  if (forProduct.length === 0) {
    return { ok: true, productPackageId: null, conversionFactor: 1, source: "base-uom" };
  }

  // 4. Exactly one package: nothing to choose between.
  if (forProduct.length === 1) return take(forProduct[0].id, "sole-package");

  // 5. Several packages and nothing to pick between them. This is the case that
  //    corrupted the ledger — refusing beats booking cartons as millilitres.
  const options = forProduct.map((p) => `${p.packageLabel} (×${toFactor(p.conversionFactor) ?? "?"})`);
  return {
    ok: false,
    productId: line.productId,
    reason: "AMBIGUOUS_PACKAGE",
    message:
      `${name}: choose a package before receiving — ${forProduct.length} are defined ` +
      `(${options.join(", ")}) and they differ in size, so the quantity is meaningless without one.`,
  };
}

/**
 * Resolve every line, returning either all resolutions or all rejections.
 *
 * All-or-nothing on purpose: a receipt is one physical delivery, and booking
 * half of it while rejecting the rest would leave stock in a state nobody can
 * reason about. Rejections are returned together so the receiver fixes every
 * bad line in one pass instead of resubmitting per error.
 */
export function resolveReceiptPackages(
  lines: ReceiptLine[],
  ctx: ResolveReceiptPackageContext,
): { ok: true; resolved: ResolvedReceiptPackage[] } | { ok: false; errors: RejectedReceiptPackage[] } {
  const resolved: ResolvedReceiptPackage[] = [];
  const errors: RejectedReceiptPackage[] = [];
  for (const line of lines) {
    const r = resolveReceiptPackage(line, ctx);
    if (r.ok) resolved.push(r);
    else errors.push(r);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, resolved };
}
