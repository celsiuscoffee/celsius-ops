# AOV-at-POS Loop (activate the dormant upsell, close the loop)

> Office-hours diagnostic, 2026-06-20. Chosen over the outbound campaign agent because
> push reaches only **28 of 21,008 members** and SMS is 59% blocked — outbound marketing
> has flat tyres. The AOV loop hits **100% of buyers** at the till, needs zero reach, and
> the engine is already built.

## Problem Statement

POS AOV is **RM28.68** vs the **RM40** target (business model). Baskets average **2.12
units**, and **~44% of orders are a single item** — a drink and nothing else. The
"Pair with a Bite" suggest-pairs engine exists to fix this but is **dormant**: it fired on
**24 of 2,178 orders (~1%)** in the last 30 days, and only from the register surface.

## Demand Evidence (live, kqdcdhpnyuwrxqhbuyfl, 30 days to 2026-06-20)

- 2,178 real POS orders; AOV **RM28.68**; **2.12 units/order**.
- **Single-item orders by round** (the prime attach target):
  | Round | Orders | AOV | % single-item |
  |---|---|---|---|
  | Breakfast | 482 | 28.88 | 38% |
  | Brunch | 302 | 27.03 | **49%** |
  | **Lunch** | 374 | **25.66** | **52%** |
  | Midday | 465 | 29.40 | 45% |
  | Evening | 338 | 31.03 | 43% |
- Upsell engine: **63 pair events on 24 orders in 30d (~1% penetration)**, source = `register`
  only. Customer display and pickup app surfaces are unused.
- (Volume is ramping — Shah Alam + Tamarind only cut over to POS-native 2026-06-15, so order
  counts will grow toward the ~90/day/outlet target; the AOV/attach ratios are the signal.)

## Status Quo (what happens now)

Cashier rings a drink. The suggest-pairs prompt almost never shows (1%). Customer pays for
one drink and leaves. No suggestion on the customer display, none in the pickup-app cart.
~44% of baskets stay single-item.

## Target User (named person)

> **To confirm with Ammar:** the cashier/barista at the till is the actor for the register
> wedge. Who owns the POS register UX decisions? (Same person who locked the POS UX
> improvements.) For the pickup-app surface, the actor is the online customer.

## Narrowest Wedge

Force the suggest-pairs prompt on the register **when the basket is a single item**,
targeted hardest at **Lunch and Brunch**, with a **one-tap full-price add** (no discount).
The engine already ranks the suggestion; the gap is it isn't shown. Log impression + add so
attach-rate is measurable from day one.

## The Loop (steady state)

1. **Sense** — each basket's items + round + outlet → flag single-item / drink-only.
2. **Act** — surface the ranked attach suggestion at the till (and later display + pickup cart).
3. **Measure** — attach-rate (shown→added) and AOV lift vs baseline, by round/outlet/suggestion.
4. **Tune** — the gated `tune_pair_weights()` auto-tuner reweights suggestions toward what
   actually converts. Loop closes.

## Premises

1. Suggestion units are integers in sen (÷100 = RM). Confirmed (AOV math checks out).
2. `pos_pair_events` currently logs adds from `register` only; needs an impression event to
   compute a true attach-rate. (To verify in code.)
3. A full-price attach beats a discount (North Star: discounts last resort). Combos only if
   BOM-margin-positive — margin data now available via BOM cost.
4. The till must stay fast (POS UX: big targets, no friction). One tap, dismissable.

## Approaches Considered

### Approach A — Activate the register prompt (days)
Show the suggest-pairs prompt whenever basket = 1 item, prominent + one-tap, weighted to
Lunch/Brunch. Add an impression event to `pos_pair_events` so attach-rate is measurable.
Pure activation of built code. Ships in days.

### Approach B — Multi-surface + closed measurement loop (weeks)
A + push suggestions to the **customer display** ("Add a {bite} — RM{x}") and the
**pickup-app cart**, + a weekly attach-rate/AOV dashboard by round/outlet, + enable the
gated `tune_pair_weights()` auto-tuner. This is the full self-optimizing loop.

### Approach C — Dynamic bundling & margin-aware pricing (months)
B + auto-generated combos and price points from BOM margin + demand elasticity, auto-applied
under a margin floor (the "dynamic menu & pricing" loop). Bigger, riskier (auto-pricing),
only after B proves the attach-rate loop converts.

## Recommended Approach

**A → B.** A turns on dormant value and proves attach-rate moves; B closes the
measure+tune loop and adds the high-reach surfaces (display, pickup cart). C waits until B
shows conversion and a margin floor is defined.

**What would flip it:** if A shows the forced prompt slows the till or annoys cashiers
without lifting attach-rate, pivot the wedge to the **customer-display** surface (self-serve,
zero cashier friction) as the primary lever instead of the register prompt.

## Open Questions

- Does `pos_pair_events` log impressions, or only adds? (Decides whether attach-rate is
  measurable today.) — verify in the suggest-pairs route.
- Attach target: single-item baskets only, or also drink-only 2-item baskets (drink+drink → add bite)?
- Customer-display surface: does the current display render arbitrary prompts, or only the
  round splash posters? (Affects Approach B effort.)
- Combo vs straight add: do we ever bundle at a small margin-positive discount, or strictly
  full-price adds?

## Success Criteria (measurable)

- Upsell penetration: **~1% → >60% of single-item orders see a prompt** within one cycle.
- Attach-rate (shown→added): establish baseline, then **>10%**.
- AOV: **RM28.68 → RM32+** in 60 days, Lunch round **RM25.66 → RM29+**.
- Zero measurable till-speed regression (order-to-pay time).

## The Assignment (one concrete next step)

Before building: stand at the busiest till through one **Lunch** round (1–2pm) and watch 20
single-drink orders. Count how many the cashier *could* have attached a bite to in one
sentence, and note what the customer was buying. That tells us the realistic attach ceiling
and which 2–3 pairings to hard-wire first.
