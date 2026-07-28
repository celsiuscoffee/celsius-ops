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
