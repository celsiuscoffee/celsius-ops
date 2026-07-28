# Food-cost micro variance — July 2026 (per-ingredient detail)

Companion to `food-cost-gap-2026-07-27.md`. Owner ask: "which specific
ingredients — show items sold, expected usage and purchased/real usage, so we
know at micro level what to check and how to intervene."

Scope: 3 till outlets (Nilai/IOI excluded — no item sales). July 1–27.
- **Expected usage** = items sold (POS + QR/pickup, 94–96% menu-matched) ×
  `MenuIngredient` dose.
- **Purchased (recorded)** = PO qty × package conversion. **Purchased @list**
  = spend ÷ supplier-list cost/unit — the honest volume where the §3a package
  mis-selection inflates the recorded number (milk!).
- Expected EXCLUDES: GastroHub production (~RM11–12k/mo revenue), staff meals,
  fryer-oil changes, month-boundary stock. Ratios up to ~1.2–1.3 can be
  normal; ≥1.5 is a real signal.

## Table 1 — chain-wide, top ingredients by July spend

| Ingredient | Spend RM | Sold (items) | Expected | Purchased (recorded → @list) | Ratio | Excess RM | What to check |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home Blend beans (g) | 23,529 | 9,049 drinks | 163 kg | 253 → 277 kg | **1.70** | 9,684 | grams/shot + dial-in waste + staff drinks; weekly kg count vs POS shot count |
| Fresh Milk (ml) | 14,869 | 10,758 drinks | 1,253 L | 3,368 L rec → **2,182 L real** | **1.74** | 6,327 | fix package data first; then pitcher/steaming waste; real pour vs 120–140ml BOM |
| Chicken Chop (g) | 5,586 | — | **NO BOM** | 348 kg | — | ? | add recipe — RM5.6k/mo invisible |
| Brioche Sandwich (pcs) | 5,260 | 736 sandwiches | 1,472 | 3,001 | **2.55** | 3,200 | PJ 2.9×; bread waste/staff meals/GastroHub? |
| Telur Omega (pcs) | 4,423 | 2,364 dishes | 2,949 | 5,810 | **2.00** | 2,211 | **PJ 3.9×** vs SA/Tam 1.9× — PJ egg orders |
| Matcha Powder (g) | 3,960 | 1,619 | 8.0 kg | 10 kg | 1.25 | 796 | OK-ish |
| Chocolate Powder (g) | 3,560 | 1,064 | 33.8 kg | 40 kg | 1.18 | 554 | OK |
| Chocolate Mudslide (pcs) | 3,510 | 261 slices | 261 | 324 | 1.24 | 683 | mild display waste |
| Brioche Loaf (pcs) | 3,195 | 1,252 | 2,504 | 3,000 | 1.20 | 528 | OK-ish |
| Burnt Cheesecake (pcs) | 3,100 | 200 slices | 200 | 372 | **1.86** | 1,433 | **SA 3.7×** — SA orders 132/mo, sells ~50 |
| Emborg Cooking Cream (ml) | 2,874 | 570 dishes | 109 L | 199 rec → 161 L | 1.48 | 930 | batch prep size |
| Monin Vanilla (ml) | 2,858 | 3,057 drinks | 34.3 L | 58 L | **1.69** | 1,164 | free-pour vs pump; 13–15ml dose |
| Salted Croissant (pcs) | 2,046 | 192 sold | 192 | 336 | **1.75** | 877 | flat 112/outlet standing order vs 47–61 sold |
| Almond Croissant (pcs) | 2,250 | 171 | 171 | 250 | 1.46 | 711 | same standing-order problem |
| Pull Lamb (g) | 1,937 | **90 plates** | 4.5 kg | 15 kg | **3.33** | 1,356 | slow item, batch too big — shrink batch or cut menu |
| Santan Kara (ml) | 1,741 | 179 bowls | 48 L | 88 rec → 115 L | 2.37 | 1,007 | curry batch size vs demand |
| Smoked Duck (g) | 1,680 | 191 plates | 9.6 kg | 20 kg | 2.00 | 840 | portioning 50g? batch waste |
| Streaky Beef (g) | 1,560 | 944 | 21.9 kg | 40 kg | 1.83 | 707 | portioning |
| Cooking Oil (g) | 1,278 | 688 fried | 34 kg | 190 kg | 5.6 | ~1,051 | BOM only counts absorption — fryer-change SOP (top-up, schedule by use) |
| Udang (g) | 1,278 | 202 bowls | 16.2 kg | 81 kg | **5.3** | 1,036 | **PJ bought 60 kg** for ~5 kg need — freezer stock? package error? |
| Classic Croissant (pcs) | 1,705 | 250 | 250 | 310 | 1.24 | 330 | mild |
| Biscoff Batik (pcs) | 2,200 | — | **NO BOM** | 220 | — | ? | add recipe |
| Tomato Puree (g) | 1,264 | — | **NO BOM** | 73 kg | — | ? | add recipe |
| Plastic Cup (pcs) | 1,770 | 238 | 238 | 6,000 | 25× | — | not a leak: packaging not mapped in BOM; map via packaging-rules |

(ICEHOT foam reads 0.69 — under-purchased vs BOM → its dose is overstated;
recipe check the other direction.)

## Table 2 — what drives each big ingredient (items sold, July)

- **Beans**: Latte 2,518 × 18g, Buttercream Latte 1,244 × 18g, Black 1,044 ×
  18g (then Spanish, Cappuccino, Mont Blanc… all 18g/shot).
- **Fresh Milk**: Latte 2,518 × 120ml, Buttercream Latte 1,244 × 140ml,
  Spanish Latte 753 × 120ml (+ matcha/chocolate line at 120–140ml).
- **Brioche Sandwich**: Streaky Beef Pesto 250 × 2pcs, Egg Sando 225 × 2,
  Korean Crispy Chicken 134 × 2.
- **Telur Omega**: Roti Bakar w/ Half-Boiled Eggs 535 × 2, Nasi Lemak +
  Ayam Crispy 373 × 1, Nasi Lemak 309 × 1.
- **Monin Vanilla**: Buttercream Latte 1,244 × 13ml, Matcha 718 × 10ml,
  Vanilla Latte 414 × 15ml.
- **Udang / Santan**: Mee Kari 110, Bihun Kari 46, Bihun Kari Asam 23
  (80g prawn + 240ml santan per bowl).
- **Pull Lamb**: Smoked Pulled Lamb 90 × 50g. **Smoked Duck**: Aglio Olio
  191 × 50g. **Streaky Beef**: Pesto 250 × 50g + duck/carbonara garnish.
- Cheesecake/croissants/cakes: 1 pc sold = 1 pc used (direct count).

## Table 3 — per-outlet ratio (purchased ÷ expected)

POS-channel expected only (QR/pickup ~20–25% of orders not outlet-split
here), so ratios read ~1.2–1.3× high — compare BETWEEN outlets, not to 1.0.

| Ingredient | Putrajaya | Shah Alam | Tamarind |
| --- | --- | --- | --- |
| Beans | **2.02** | 1.92 | 1.68 |
| Fresh Milk (recorded — package-suspect) | **4.30** | 1.79 | 4.08 |
| Telur Omega | **3.94** | 1.92 | 1.89 |
| Brioche Sandwich | **2.93** | 2.26 | 2.82 |
| Burnt Cheesecake | 2.13 | **3.67** | 1.74 |
| Salted Croissant (112 bought EACH) | 1.84 | 2.24 | 2.38 |
| Almond Croissant | 1.61 | 1.51 | 2.21 |
| Chocolate Mudslide | 1.29 | 1.64 | 1.22 |
| Cooking Oil | 9.9 | 10.1 | 9.1 |
| Udang | **12.1** (60 kg!) | 7.1 | — |
| Pull Lamb | 5.0 | 5.9 | — |

Milk per-outlet is data-suspect until the §3a package fix: PJ/Tam "4×" is
partly (maybe mostly) mis-selected 12×2L packages; SA at 1.79 recorded is the
believable shape. Re-read after backfill.

## Stock-up or real usage? (owner question, settled with counts + cadence)

Three tests, all run against prod:

1. **Physical stock counts show no pile-up.** Latest submitted counts
   (Jul 12 PJ / Jul 13 SA / Jul 19 Tam), on hand:
   - Beans: PJ **0 g**, SA 19 kg, Tam 22 kg → **41 kg chain-wide ≈ 4–5 days
     buffer.** July alone bought ~90–110 kg above need; 3-mo cumulative gap
     ~580 kg. If it were stock-up the shelves would hold hundreds of kg.
     The beans are gone — consumed or lost.
   - Milk: 14 L + 83 L + 32 L = **129 L ≈ ~1 day's usage.** Also perishable
     (days, not months) — a 3-month 1.7× ratio physically cannot be inventory.
   - Eggs 565 pcs, sandwiches 250 pcs on hand — days of buffer vs a
     ~1,500–2,900/mo excess.
2. **Purchase cadence = replenishment, not hoarding.** Beans and milk are
   bought EVERY week, steady volumes (beans ~70–150 kg/wk, milk ~0.5–1.0 M
   ml/wk recorded, May→Jul). Stock-up looks like one bulk buy then silence;
   this is continuous topping-up of something that keeps running out.
3. **The exceptions the counts DID find (freezer/aging stock):**
   - **Pull Lamb: 11 kg of the 15 kg bought is in the freezer** — its 3.3×
     is mostly genuine stock-up; real excess small. Udang: 22 kg on hand of
     81 kg bought — partial stock-up, but ~60 kg still unaccounted.
   - **PJ held 72 slices of Burnt Cheesecake on Jul 12** — that's aging
     display stock that becomes waste; over-ordering caught in the act.
   - Data-quality flag: Tamarind's Jul 19 count shows **560 salted
     croissants on hand** — implausible (likely counted in packs or typo);
     stock counts need the same package-selection discipline as POs.

Net: for the big leak items (beans, milk, eggs, sandwiches, pastries) the
excess is REAL consumption/loss. Only slow freezer proteins carry a genuine
stock component, and even there half or more is unexplained.

## Apr–Jul extension + raw ledger (2026-07-28, owner: "not robust enough — include raw data and ledger")

Full period Apr 1 – Jul 27, real item-level sales for ALL months (StoreHub era
via `storehub_sale_items`, 130k rows, matched on storehub_product_id →
Menu.storehubId; post-cutover via pos/pickup items). Raw line-level ledgers
committed: `docs/data/food-cost-po-ledger-apr-jul-2026.csv` (383 PO lines,
top-8 leak ingredients) and `docs/data/food-cost-bank-ledger-apr-jul-2026.csv`
(1,676 RAW_MATERIALS bank lines, RM584k). Sheets version:
"Celsius Food Cost Apr-Jul 2026 - with Ledger" (barista@ Drive).

**Top-down Apr–Jul (bank lens, gross rev incl GH): 45.4 / 42.5 / 45.8 /
39.5% → 4-mo 43.4% vs 38% plan ≈ RM70k excess ≈ RM17.5k/mo.** April PO
records cover only ~33% of April's bank raw-material cash (procurement
adoption) — April is bank-lens only.

**Cumulative 4-mo ratios (robust — smooths bulk-buy months). CONFIRMED:
beans 1.92× (1,032 kg bought vs 537 kg needed May–Jul; ~RM46k excess ≈
RM11.5k/mo — the dominant leak), brioche sandwich 1.65×, streaky beef
1.59×, smoked duck 1.48×, santan 1.39×, milk TRUE 1.31× (~RM3k/mo — the
2.45× recorded is the package bug), eggs 1.27× and worsening
(1.51/1.38/1.90 May→Jul, PJ-driven), lamb 3.37× (mostly freezer).
CORRECTED — July-only reads were buy-cycle artifacts, fine cumulatively:
almond croissant 1.00, classic 0.87, cheesecake 1.14, mudslide 1.15,
matcha 1.08, choc powder 0.85, cooking cream 0.93, brioche loaf 1.15.
The display-pastry-waste claim is therefore DOWNGRADED (salted croissant
2.24× rests on a conversion-suspect April line; ex-Apr it is 0.99).**

Ledger-exposed data errors (each visible as a line in the PO CSV): milk
"12×2L" cartons paid at 12×1L prices every month (Apr/May also have
RM30–40/carton lines needing human check); June udang "230 kg" for RM879
(conversion error); April salted croissant "1,848 pcs" for RM1,998; June
brioche sandwich bulk-buy of 613 loaf-packs (6,130 pcs, RM9.9k) then July
bought with no package selected. Reorder priorities accordingly: beans
count-and-reconcile weekly is action #1; eggs at PJ #2; protein portioning
#3; package hygiene fix underpins everything.

## Intervention playbook (micro)

1. **Standing orders vs sell-through (pastries)**: all 3 outlets take a flat
   112 salted croissants/mo and sell 47–61. Set order = trailing-2-week sales
   +15%. Same for cheesecake (SA!), almond croissant, cakes. ~RM4–5k/mo.
2. **PJ specifically**: eggs (3.9×), brioche (2.9×), udang (60kg), pull lamb —
   sit with the PJ kitchen order sheet for one week; compare to Tamarind's.
   (Confirm how much of PJ's buying feeds GastroHub first.)
3. **Beans**: weekly physical kg count per outlet vs POS drink count
   (9,049 drinks ≈ 163 kg). The ~90–110 kg/mo gap = dial-in waste + staff
   drinks + shrink — the count localises it in 2 weeks. ~RM9.7k/mo at stake.
4. **Milk**: fix the PO package data, THEN re-measure. True usage ~2,180 L vs
   1,253 L BOM-expected — verify the real pour (BOM says 120–140ml; a 12oz
   latte is nearer 200ml). If the pour is right, the recipe is wrong and menu
   margins are ~RM0.4–0.6/drink worse than modelled.
5. **Slow proteins (lamb, duck, prawns, santan)**: batch-prep sizes ignore
   demand (90 lamb plates/mo). Halve batch or prune menu. ~RM3–4k/mo.
6. **Syrups**: pumps not free-pour (Monin 1.69×). ~RM1k/mo.
7. **Fryer oil**: schedule changes by fry-count, top-up between. ~RM0.8k/mo.
8. **Add BOMs**: Chicken Chop, Biscoff Batik, Tomato Puree, rice — RM16k/mo
   of spend currently invisible to this table.
9. Once the weekly variance loop runs (cogs-activation W5), this exact table
   regenerates weekly per outlet — interventions become measurable.
