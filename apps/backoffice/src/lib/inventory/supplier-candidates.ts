// Which SupplierProduct rows may act as a PRICE SOURCE for the reorder engines
// (ai-decisions, reorder-suggestions). Pure so it unit-tests without a DB.
//
// Excluded on purpose:
//  - price <= 0                 — a RM0 line would win "cheapest" and emit a RM0 PO
//  - supplier not ACTIVE        — retired suppliers must not receive POs
//  - the ADHOC supplier         — pay-and-claim placeholder, carries RM0 prices
//  - rows with no productPackage — SupplierProduct.price is per PACKAGE; with no
//    package there is no unit basis to compare against other suppliers.

export const ADHOC_SUPPLIER_CODE = "ADHOC";

type DecimalLike = number | string | { toString(): string };

export type PriceSourceCandidate = {
  price: DecimalLike;
  isActive?: boolean;
  productPackageId?: string | null;
  productPackage?: { conversionFactor: DecimalLike } | null;
  supplier: { status?: string | null; supplierCode?: string | null } | null;
};

export function isPriceSourceCandidate(sp: PriceSourceCandidate): boolean {
  if (sp.isActive === false) return false;
  if (!sp.supplier) return false;
  if (sp.supplier.status && sp.supplier.status !== "ACTIVE") return false;
  if (sp.supplier.supplierCode === ADHOC_SUPPLIER_CODE) return false;
  const price = Number(sp.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!sp.productPackage) return false;
  const cf = Number(sp.productPackage.conversionFactor);
  if (!Number.isFinite(cf) || cf <= 0) return false;
  return true;
}
