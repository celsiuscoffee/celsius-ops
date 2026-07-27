# Food-cost gap investigation — 2026-07-27

Owner question: expected cost structure (Google Sheet "expected cost structure",
2026 plan) says the group should throw off ~RM46.7k net cash/month, but "we
barely have enough every month". Prior wins: part-timer/people cost (~RM13k/mo)
and ads optimisation (~RM7k/mo). Where is the rest going?

**Answer: food cost is the biggest recurring gap, compounded by a systemic
package-selection data bug. Against the correct denominator (owner correction:
gross revenue pre-commission, ALL outlets incl. Nilai + IOI + GastroHub),
raw-material cash-out runs ~41.6% (3-mo avg; May 41.3 / Jun 44.1 / Jul 39.2)
vs the 38% plan → ~RM12–15k/mo, and the PO-commitment lens reads higher
(46.4% 3-mo) — call it RM12–25k/mo. The rest of the missing ~RM46.7k plan net:
people ~+RM10k/mo vs plan, ads over-spend (~RM9k in June, since fixed),
GastroHub revenue at half of plan (12k vs 25k), and June one-offs
(compliance RM16k). It is NOT supplier pricing and NOT (recorded) wastage;
it is real over-consumption/over-purchase on conversion-unambiguous items
(beans, pastries, eggs, sandwiches ≈ RM20k/mo hard evidence) plus a
PO-package mis-selection bug that inflates recorded volumes on ~10 products.**

All figures SQL-verified against prod (kqdc) on 2026-07-27. July = through the
27th; June item-level data is contaminated by the StoreHub cutover (item rows
only complete from mid-June), so July is the clean diagnostic month.

## 1. Top-down: the gap is real and it is food cost

Denominator per owner correction: gross revenue pre-commission = unified_sales
nett ALL outlets (incl. Nilai consignment + IOI) + GastroHub bank credits.

| Month | Gross revenue | RAW_MATERIALS cash out | Cash % | PO commitments | PO % | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| May | RM369.5k | RM152.7k | 41.3% | RM205k | 55.5% | 38% |
| Jun | RM342.0k | RM150.8k | 44.1% | RM127k | 37.1% | 38% |
| Jul (→27) | RM303.1k | RM118.9k | 39.2% | RM138k* | 45.6% | 38% |
| 3-mo | RM1,014.5k | RM422.4k | **41.6%** | RM470k | **46.4%** | 38% |

*incl. RM80k open (approved/sent/awaiting) POs, some not yet delivered. May's
PO spike is partly system-adoption catch-up; the two lenses bracket the truth
(cash lags via unpaid AP — RM45k+ pending). Recurring food-cost gap:
**~RM12–25k/mo** vs plan.

### 1a. Apples-to-apples scope (owner: exclude Nilai + IOI — no item sales, cannot check BOM)

Nilai/IOI are consignment (no till items → no theoretical), and they add
revenue with almost no purchases, so excluding them RAISES the measured %.
Three till outlets + GastroHub credits (GH supply rides these outlets' POs):

| Month | Revenue (3 outlets + GH) | Cash %† | PO % | Plan |
| --- | --- | --- | --- | --- |
| May | RM349.8k | 42.5% | 57.4% | 38% |
| Jun | RM324.6k | 45.8% | 40.8% | 38% |
| Jul (→27) | RM290.3k | 39.5% | 46.6% | 38% |
| 3-mo | RM964.6k | **42.7%** | **48.6%** | 38% |

†bank RAW_MATERIALS minus Nilai/IOI PO amounts (bank feed can't split them;
RM2–4k/mo). Clean-scope gap: **~RM15–30k/mo**.

Per-outlet (PO purchases ÷ own till revenue): Tamarind Jun 33.6% / Jul 39.3%
(June ON plan), Shah Alam 43.3% / 49.0%, **Putrajaya 47.5% / 54.0%** (~43–49%
if all GastroHub supply is credited to PJ — confirm with ops which outlet
feeds GH). Same menu, same suppliers, same prices → if PJ + SA bought at
Tamarind's ratio that alone is ~RM20–25k/mo. The fastest practical probe is a
PJ-vs-Tamarind item-level order-habit comparison, not a chain-wide program.

July bottom-up restated for the 3-outlet scope: spend RM142.4k, no-BOM
RM16.4k, nominal excess RM49.5k; beans 253kg vs 160kg (1.58×, ~RM8.6k).

June cash P&L (external): inflows ~RM336k vs outflows ~RM333k → ~breakeven,
which matches "barely enough". People (salary+PT+statutory) RM104k ≈ 32% vs
plan ~26% is the second, smaller gap (~RM10k, partly addressed by the Jul
roster baseline); rent/utilities/loan are on plan; ads already fixed.

## 2. Bottom-up: purchases vs theoretical consumption (July)

Method: drinks/food sold (pos_order_items + pickup/QR order_items, 94–96%
matched to `Menu` via storehubId) × `MenuIngredient` doses, vs purchased base
units (OrderItem qty × ProductPackage.conversionFactor).

Aggregate, July: **ingredient PO spend RM146.3k; RM129.9k of it has a BOM;
nominal excess over theoretical = RM53.3k** (RM52.5k re-valued at true unit
costs). After the §3a package-artifact haircut, lean-BOM bias, and
GastroHub/Nilai production (~RM5–8k), the defensible hard core is
**~RM20k+/mo on conversion-unambiguous items alone**: beans ~RM9.6k, display
pastries ~RM5.5k (336 salted croissants bought/189 sold, cheesecake 360/199),
eggs ~RM2.2k, brioche sandwiches ~RM2.6k. RM16.4k of spend has no recipe at
all (Chicken Chop RM5.6k/mo, Biscoff Batik, Tomato Puree, rice —
recipe-drift, warehouse check 22 material).

Headline items (purchased ÷ theoretical, July):

| Item | Purchased | Theoretical | Ratio | Note |
| --- | --- | --- | --- | --- |
| Fresh Milk | ~2,100–2,500 L real (RM17.6k) | 1,235 L | ~1.7× nominal | recorded 3,944 L is a DATA ARTIFACT — see §3a; at realistic ~200ml pours milk is near-parity |
| Home Blend beans | 263 kg (RM24.5k) | 160 kg (8,893 drinks × 18g) | 1.6× | kg format, conversion-clean — hard evidence, ~RM9.6k/mo |
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
~480–500 kg theoretical — beans keep, but a 3-month 2× ratio at ~RM9.6k/mo is
consumption/loss, not inventory. Bank vs PO totals reconcile (RM422k paid vs
RM470k ordered, lag + RM45k unpaid AP), so it isn't PO double-counting either.

## 3. What it is / isn't

### 3a. Package mis-selection bug (owner-caught, confirmed in data)

Owner: "1L milk should be ~RM7 — the 24L format is probably not set properly."
Confirmed, and it's the PO line, not the package config: the supplier price
list has Carton 12×2L at RM163.58–174.96 (= RM6.8–7.3/L ✓) and Carton 12×1L
at RM84–84.46 — but July POs paid avg **RM95.54 against the 12×2L package**,
i.e. buyers order/receive the 12L carton while picking the 24L package on the
PO. Recorded milk volume is therefore ~2× inflated; the earlier "3.2×" milk
ratio corrects to ~1.7× nominal (near-parity at realistic pours), and the
earlier "RM3.98/L cheap format" was fiction — milk really costs ~RM7/L
everywhere. **The same too-cheap-per-base-unit signature exists on 10+
products** (Oatside carton paying ~a 1L price, Emborg whipping cream 14.9×,
Samyang 43×, Planta 14.5×, peanut butter 12×, pesto 10.4×, dishwash 11.3×,
Monin 4×, udang 2.8×) — so g/ml-based ratios in §2 for THOSE items are
overstated; pcs/kg-clean items (beans, pastries, eggs, sandwiches) stand.
Consequences beyond analytics: any future product_costs/menu-margin derivation
(cogs-activation W3/W4) will read garbage until PO/receiving package selection
is guarded. Fix shape: default the PO line package from the supplier-product
row + flag any line whose unit price deviates >40% from the supplier-list
price for the selected package.

- **Pricing: NO.** Bean cost/drink ≈ RM1.67, milk ≈ RM1.40/latte at the true
  RM7/L; `PriceHistory` has zero recorded increases since April.
- **Recorded wastage: NO.** StockAdjustment totals RM0.1–1.1k/mo — i.e. waste
  is simply not being logged, so waste-vs-theft cannot be separated from data
  today.
- **Over-purchase + untracked waste/shrink: YES.** Reorder runs off receipts
  minus wastage/transfers, NOT sales (consumption engine still shadow + reading
  the dead SalesTransaction table), so nothing in the loop pushes back when an
  outlet orders above its sell-through. Display pastries (bake/buy-to-display,
  ~45% unsold), beans, eggs/sandwiches, and kitchen proteins are where the
  ringgit is.
- **Theft: cannot be ruled out** (beans are resellable, 1.6× on a
  conversion-clean kg format) — but indistinguishable from unrecorded waste
  until wastage logging + weekly counts exist.
- Caveats absorbed in the numbers: GastroHub vendor supply (~RM12k/mo revenue,
  bank lens only) and Nilai consignment production consume purchases without
  till items (~RM5–8k/mo generosity), unmatched items 4–6%, BOM doses lean,
  §3a package artifacts on ml/g items. The residual recurring leak is
  **~RM12–25k/mo** (top-down) with ~RM20k/mo bottom-up hard evidence.

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
6. **Fix the PO package-selection bug (§3a)**: default package from the
   supplier-product row + price-vs-package guard (±40% of list). Backfill the
   obviously mis-selected historical lines so cost analytics stop lying.
   Verify barista milk-pour vs the 120–140ml BOM while at it (fix the BOM —
   the margin truth improves either way).
7. After 2–4 weeks of the above: re-run this analysis; target food cost ≤40%
   short-term (≈+RM10–15k/mo cash), 38% at par levels + waste under control.

## Appendix: queries

All queries in the session transcript; the core variance query joins
pos_order_items/order_items → Menu(storehubId) → MenuIngredient vs
OrderItem × ProductPackage.conversionFactor, July window, MYT.
