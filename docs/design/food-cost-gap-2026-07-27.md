# Food-cost gap investigation — 2026-07-27

Owner question: expected cost structure (Google Sheet "expected cost structure",
2026 plan) says the group should throw off ~RM46.7k net cash/month, but "we
barely have enough every month". Prior wins: part-timer/people cost (~RM13k/mo)
and ads optimisation (~RM7k/mo). Where is the rest going?

**Answer: food cost. The plan assumes COGS = 38% of revenue; actual raw-material
cash-out is running 47–49%. On ~RM320k/mo of sales inflows that is ~RM30–35k/mo
of missing cash — essentially the whole gap. It is NOT a supplier-pricing
problem and NOT (recorded) wastage; it is consumption/purchasing running
1.5–3× what sales justify, across nearly every top ingredient.**

All figures SQL-verified against prod (kqdc) on 2026-07-27. July = through the
27th; June item-level data is contaminated by the StoreHub cutover (item rows
only complete from mid-June), so July is the clean diagnostic month.

## 1. Top-down: the gap is real and it is food cost

Bank lens (`BankStatementLine`, external only, `isInterCo=false`):

| Month | Sales inflows* | RAW_MATERIALS out | Food cost % | Plan |
| --- | --- | --- | --- | --- |
| May | ~RM312k | RM152.7k | ~49% | 38% |
| Jun | ~RM323k | RM150.8k | ~47% | 38% |
| Jul (→27) | ~RM249k | RM118.9k | ~48% | 38% |

*card+QR+RM+StoreHub+Grab+GastroHub credits; net-of-commission, so the true %
against gross revenue is a bit lower — but the plan's 38% is against the same
kind of top line. PO-lens (Order, expenseCategory=INGREDIENT, non-draft/
cancelled) agrees: May RM205k / Jun RM127k / Jul RM138k incl. open POs.

June cash P&L (external): inflows ~RM336k vs outflows ~RM333k → ~breakeven,
which matches "barely enough". People (salary+PT+statutory) RM104k ≈ 32% vs
plan ~26% is the second, smaller gap (~RM10k, partly addressed by the Jul
roster baseline); rent/utilities/loan are on plan; ads already fixed.

## 2. Bottom-up: purchases vs theoretical consumption (July)

Method: drinks/food sold (pos_order_items + pickup/QR order_items, 94–96%
matched to `Menu` via storehubId) × `MenuIngredient` doses, vs purchased base
units (OrderItem qty × ProductPackage.conversionFactor).

Aggregate, July: **ingredient PO spend RM146.3k; RM129.9k of it has a BOM;
excess over theoretical = RM53.3k (41% of BOM'd spend)**. RM16.4k of spend has
no recipe at all (Chicken Chop RM5.6k/mo, Biscoff Batik, Tomato Puree, rice —
recipe-drift, warehouse check 22 material).

Headline items (purchased ÷ theoretical, July):

| Item | Purchased | Theoretical | Ratio | Note |
| --- | --- | --- | --- | --- |
| Fresh Milk | 3,944 L (RM17.6k) | 1,235 L | 3.2× | BOM doses are lean (latte=120ml); even at a realistic ~200ml pour it's ~1.5–1.7× |
| Home Blend beans | 263 kg (RM24.5k) | 160 kg (8,893 drinks × 18g) | 1.6× | RM93/kg, price flat — not pricing |
| Brioche Sandwich | 2,973 pcs | 1,448 | 2.1× | |
| Telur Omega | 5,810 pcs | 2,891 | 2.0× | |
| Salted Croissant | 336 pcs | 189 sold | 1.8× | display-case waste, direct count |
| Burnt Cheesecake | 360 pcs | 199 sold | 1.8× | |
| Pull Lamb | 15 kg | 4.5 kg | 3.3× | |
| Cooking Oil | 190 kg | 34 kg | 5.6× | fryer cycles not in BOM, partly legit |
| Udang | 81 kg | 16 kg | 5.0× | |
| Monin Vanilla / Cooking Cream / Santan | — | — | 1.7–1.8× | |
| Brioche Loaf / Choc Powder / Matcha | — | — | 1.06–1.26× | proof the method reads ~1.0 when usage is tight |

Persistence check (not a stock build-up): beans May–Jul purchased 1,082 kg vs
~480–500 kg theoretical; milk 12,300 L vs ~3,700 L theoretical (+ lean-dose
adjustment still ≤6,500 L). Milk is perishable — a 3-month 2×+ ratio is
consumption/loss, not inventory. Bank vs PO totals reconcile (RM422k paid vs
RM470k ordered, lag + RM45k unpaid AP), so it isn't PO double-counting either.

## 3. What it is / isn't

- **Pricing: NO.** Bean cost/drink ≈ RM1.67, milk ≈ RM0.5–0.9; `PriceHistory`
  has zero recorded increases since April. (One arbitrage: Fresh Milk in
  12×1L cartons costs RM7.15/L vs RM3.98/L in 12×2L — July bought 552 L of the
  dear format ≈ RM1.7k/mo giveaway.)
- **Recorded wastage: NO.** StockAdjustment totals RM0.1–1.1k/mo — i.e. waste
  is simply not being logged, so waste-vs-theft cannot be separated from data
  today.
- **Over-purchase + untracked waste/shrink: YES.** Reorder runs off receipts
  minus wastage/transfers, NOT sales (consumption engine still shadow + reading
  the dead SalesTransaction table), so nothing in the loop pushes back when an
  outlet orders 2× its sell-through. Display pastries (bake/buy-to-display,
  ~45% unsold), kitchen proteins, and milk are where the ringgit is.
- **Theft: cannot be ruled out** (beans are resellable; milk 3×) — but
  indistinguishable from unrecorded waste until wastage logging + weekly counts
  exist.
- Caveats absorbed in the numbers: GastroHub vendor supply (~RM12k/mo revenue,
  sold via bank lens only) and Nilai consignment production consume purchases
  without till items (~RM5–8k/mo generosity), unmatched items 4–6%, BOM doses
  lean. The residual leak is still ~RM25–35k/mo.

## 4. Recommended actions (ranked by cash/effort)

1. **Par-level sanity pass on top-20 SKUs** against July sell-through
   (theoretical + 20% buffer). The purchasing agent keeps approving POs sized
   by receipts-based history. Immediate, no code.
2. **Display-case production discipline**: croissants/cakes ordered ≈ sold
   +15%, not +80%. Daily leftover count on the closing checklist.
3. **Activate the COGS loop (already designed — `docs/design/cogs-activation.md`)**:
   W1 re-point consumption-post to live sales (bug: reads dead SalesTransaction),
   W3 product_costs, W5 weekly theoretical-vs-actual variance per top-20
   ingredient → this report becomes an automatic weekly scoreboard instead of a
   one-off dig.
4. **Wastage logging discipline for 2 weeks** (staff app already has
   StockAdjustment) + weekly stock counts on the top-10 spend SKUs → splits
   waste vs shrink/theft with data.
5. **Add BOMs for the RM16k/mo of no-recipe spend** (Chicken Chop first).
6. **Milk pack-format fix** (~RM1.7k/mo) and verify barista milk-pour vs the
   120–140ml BOM (portioning training or fix the BOM — either way the margin
   truth improves).
7. After 2–4 weeks of the above: re-run this analysis; target food cost ≤40%
   short-term (≈+RM20k/mo cash), 38% at par levels + waste under control.

## Appendix: queries

All queries in the session transcript; the core variance query joins
pos_order_items/order_items → Menu(storehubId) → MenuIngredient vs
OrderItem × ProductPackage.conversionFactor, July window, MYT.
