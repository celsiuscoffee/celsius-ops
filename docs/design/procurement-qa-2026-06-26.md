# Procurement flow — QA pass + gap fixes (2026-06-26)

Static QA of the whole procurement/inventory loop (reorder → PO → receive →
invoice → pay → reconcile → reports), plus the data-capture audit behind the
five "empty" inventory reports. No running app was available, so this is
static analysis + targeted code review (CI typecheck/lint/test validates).

## Fixed in this PR

- **Price history captured.** `PriceHistory` existed but had zero writers, so the
  Supplier Scorecard "price changes" metric was always empty. New
  `recordPriceChange()` logs old→new + % on every `SupplierProduct.price` update.
- **`orderedQty` auto-derived on receiving.** It was client-only and is the ONLY
  surviving record of ordered qty (the receivings reconcile overwrites
  `OrderItem.quantity` with the received total). Now filled server-side from the PO
  in both the backoffice and staff receiving routes — restores short-delivery tracking.
- **Usage-variance report** (`/inventory/reports/ingredient-variance`): actual usage
  from count-bracketed stock movements vs expected (recipe BOM × sales), with
  read-time unit normalisation and graceful degradation.
- **Code-review fixes** in the P0–P2 work: tightened the over-broad payment-reference
  match (false double-payment flags), PAID→PARTIALLY_PAID on an amount-edit that
  strands a balance, `BILLED_OVER_PO` guards `amount>0` (credit notes), payment-model
  recognises "upfront".

## Open — structural, need a decision (not done here)

These are larger than a safe in-PR fix; flagging for prioritisation.

1. **Stock is tracked in mixed units, fragmented by package.** `adjustStockBalance`
   writes the raw delta with NO conversion, keyed by `(productId, productPackageId)`:
   receivings write *package* units, wastage/transfers write *base* units, for the
   same product. There is no canonical base-UOM quantity. Consequences:
   - The **Stock Valuation report is unit-buggy** (compares mixed-unit balance rows to
     counts with no conversion, and double-counts multi-package products).
   - Reorder par-level checks compare against an unreliable quantity.
   - Fix = normalise to base UOM at write time (touches `stock.ts` + counts) — a
     systemic change. The new usage-variance report works around it by converting at
     read time.

2. **Double-receiving has no idempotency.** A double-submit double-counts stock and
   the PO total (cumulative recompute + `adjustStockBalance`). PO *create* uses
   `clientRequestId`; receiving does not. Fix = a `clientRequestId` column + unique
   index (migration).

3. **Stock is never decremented by sales; no recipe source.** `adjustStockBalance` is
   never called by any sales/POS flow, and `MenuIngredient` (BOM) is manual-only with
   no import. This is why COGS and the new variance report are empty until recipes +
   sales exist, and why par-level reorder can't be trusted (the docs' load-bearing
   "stock accurate enough to auto-order" premise). Fix = a consumption engine
   (sales × recipe → decrement) + a recipe import. Largest item; underpins the loop.

4. **Lower-priority QA items:** orphaned `OrderStatus.CONFIRMED`; no PO status-transition
   allowlist; deposit rounding via `Number()` coercion; `Order.deliveryDate` optional
   (on-time rate silently drops null-date orders — could impute from `leadTimeDays`);
   backoffice wastage doesn't auto-fill cost (staff app does).

## Report emptiness — root causes (data-capture vs wiring)

- **Stock Valuation** — empty/untrustworthy: stock not decremented by sales (#3) + unit
  bug (#1).
- **COGS** — empty: no `MenuIngredient` recipes + StoreHub-only sales sync (#3).
- **Purchase Summary** — understates: `Invoice.amount` placeholders default to PO total
  or 0 and aren't synced to the supplier's real amount (P0.1 vision-capture helps).
- **Wastage** — works when `StockAdjustment` rows exist; cost falls back to supplier price.
- **Supplier Scorecard** — price-changes fixed here (#price history); short-delivery fixed
  here (`orderedQty`); on-time depends on `Order.deliveryDate` being set (#4).
