# COGS activation — design ("design 1" from the data needs register)

2026-07-18. Owner picked build-order item 1 (recipes/BOM → true COGS, item
margin, stock accuracy, consumption arming). Investigation flipped the
premise, so this is an **activation** design, not a build-from-scratch.

## Discovery corrections (SQL + code verified 2026-07-18)

The needs register said "COGS MISSING — no recipe/BOM tables exist." Wrong
on the first half of the sentence:

- **Recipes EXIST and are complete**: `MenuIngredient` — all 92 `Menu` rows
  have a BOM, 512 ingredient lines over 138 `Product` ingredients, clean
  base UOMs (124×g, 35×ml, 93×pcs; 2 stragglers bag/pack). The earlier
  table-discovery grep searched `%recipe%`/`%bom%` names and missed it —
  lesson recorded in the skill (discover via Prisma schema, not name
  patterns).
- **Unit conversion EXISTS but is under-used**: `ProductPackage`
  (`conversionFactor`, nested `containsPackageId`; 321 packages across 248
  products) — but only **29% of the 2,070 `ReceivingItem` rows** carry
  `productPackageId`, so 71% of receipts can't be converted to base units.
  This is the real shape of the "unit normalisation" prerequisite from
  procurement-qa-2026-06-26.
- **The consumption engine's blocker is a dead-table read**: the pure core
  (`lib/inventory/consumption.ts`, channel-weighted sales × BOM) is sound
  and tested, but `consumption-post.ts` pulls sales from
  **`SalesTransaction` — dead since 2026-04-11** — so the shadow engine has
  been multiplying recipes against zero sales for three months. (Warehouse
  trap-read check 3 now includes `prisma.salesTransaction` references.)
- **Costs are derivable**: `ReceivingItem` has no price; unit cost comes
  from the PO line (`OrderItem.unitPrice`) ÷ package `conversionFactor`.

## Workstreams

**W1 — Re-point consumption to live sales (agent-buildable, the bug fix).**
`consumption-post.ts` reads `pos_order_items` + pickup `order_items`
(mapped to `Menu` — the demand model already joins via `storehubId`, PR
#961 precedent) instead of `SalesTransaction`. Channel weighting stays
(pos_native carries order_type, so the DINE_IN/TAKEAWAY split can use real
data instead of the 0.5 ratio where available). Engine STAYS SHADOW.

**W2 — Package-coverage ratchet (mostly product work, agent-nudged).**
Receiving flow defaults `productPackageId` to the product's `isDefault`
package when the receiver doesn't pick one; backfill historical rows the
same way where a product has exactly one package. Warehouse check 21
tracks coverage; target ≥90% of receiving lines within a month. The 2
bag/pack base-UOM stragglers get normalised to g/pcs.

**W3 — Cost per base unit (agent-buildable derivation).**
Nightly derivation `product_costs` (SQL-managed): for each ingredient
product, moving average over the last 5 receipts of
`OrderItem.unitPrice ÷ conversionFactor` (join Receiving→Order→OrderItem
by product), with a `manual_cost` override column and a `costed_via`
provenance tag. Products with no usable receipt chain surface as a
coverage metric, not silent zeros.

**W4 — Menu margin view (the payoff surface).**
`menu_margins` view: `Menu` price − Σ(recipe qty × cost per base unit) −
packaging cost (packaging-rules already exist). Surfaced on the Catalog →
BOM page and queryable by the ops-intake assistant (data-map entry ships
with it). This answers "margin per drink" for the first time.

**W5 — Variance loop → arming criteria (the compounding part).**
Weekly: theoretical consumption (W1) vs actual depletion implied by stock
counts (`usage-variance.ts` exists) per top-20 ingredient. Pre-committed
arming criteria for the `consumption_engine` registry row: **4 consecutive
weeks with ≥80% of top-20 ingredients within ±15% variance → owner arms**
(consumption starts writing real negative `StockAdjustment`s; reorder
finally runs off sales, not receipts). Human approval required to arm, per
the substrate rules.

## Order & effort

W1 (small PR, unblocks everything) → W3 + W2 in parallel (W3 usable
immediately at 29% coverage, improves as W2 ratchets) → W4 (view + page)
→ W5 (runs 4+ weeks) → arm. Human effort is minimal by design: verify a
sample of ~10 recipe quantities against the bar's reality (the data is
3 months old), receive with package selected, and the final arming call.

## Warehouse checks added (skill)

21. Package coverage: % ReceivingItem with `productPackageId` [target
    ≥90%, ratchet — never regress]. 22. Recipe drift: menus without
    `MenuIngredient` rows [0 at baseline; any new menu without a BOM].
23. Cost coverage: % of the 138 recipe ingredients with a usable
    `product_costs` row. 24. Consumption source: no
    `prisma.salesTransaction` reads outside archived code.

## Compounding contract

Every W lands durable data others consume: W1 feeds W5 and future demand
models; W3's `product_costs` feeds W4, procurement price-anomaly checks,
and the supplier scorecards (needs register #5); W4's margins feed the
pricing/menu decisions and the round-gap promo loop's margin guardrails;
W5's variance history is the evidence base for arming and for shrinkage
detection. Corrections humans make to costs/recipes land as data
(`manual_cost`, MenuIngredient edits), not chat.
