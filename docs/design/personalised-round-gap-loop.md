# Personalised round-gap loop

Scoped via office-hours 2026-06-22 (Ammar). NOT built — wedge defined, premise-check assigned first.

## Problem Statement
Specific day-part "rounds" underperform (per the Command Center, e.g. Evening 5–7pm, Dinner 7–9pm, Supper 9–11pm). Goal: lift the weak rounds ~20% by nudging the right customers to come at that time with a personalised, margin-safe offer — without spamming and without cannibalising peak rounds (Lunch/Midday).

## Demand Evidence
- Operator-driven (Ammar), tied to per-round revenue targets on the Command Center.
- Data confirms uneven rounds. POS-hour cut (30d, all outlets): Breakfast 7–9 weakest by volume (187 ord/RM5.3k); Dinner/Supper low-volume but high-AOV (RM30–31). The per-outlet dashboard view differs (Evening 31% / Dinner 4% / Supper — of target) → **weak round depends on outlet + window; must be computed, not hardcoded.**
- This is a **growth lever, not a pain-killer** — nobody scrambles if it doesn't exist. Sequence accordingly (prove value small first).

## Status Quo
Nothing systematic drives a specific weak round via SMS. The existing `round_gap` loop is generic ("…this week", flat % discounts, no time-box, no personalisation) and unused. POS poster autopilot pushes AOV in-store but not round-timing via outbound.

## Target User
Ammar (operator) sets per-round targets; the loop auto-finds + boosts the weak ones. End recipients = existing active customers who have a clear favourite and **don't already visit at the weak round** (so the visit is incremental).

## Premises (must validate before building)
- **P1 — the weak round is OPEN.** Supper "—" / Dinner 4% may mean the outlet is closed/unstaffed then, not low demand. Marketing a closed round = texting people to a locked door. **Highest-risk assumption.**
- **P2 — an SMS nudge can shift visit-timing at all** (unproven for Celsius).
- **P3 — the personalised eligible pool is large enough.** Measured: only **245** members qualify today (clear favourite + visited ≤60d + ≥2 visits + reachable + not SMS'd in 14d). 100/day drains it in ~2.5 days → it's a burst, not a daily engine, until the pool grows / criteria loosen.

## Mechanic (no schema change needed — reuses existing primitives)
- **Time-box + targeting enforced via promo + member tags** (not vouchers — vouchers have no hour-of-day check at redemption):
  - `promotions.time_start/time_end` → enforced at till by `isPromoLiveNow`.
  - `promotions.eligible_member_tags` → only tagged members get it (`isPromoEligible`).
  - `promotions.applicable_products/_categories` → personalise to the favourite.
- **Personalisation:** per-member favourite from `pos_order_items` + `order_items` (proven: latte ×92, spanish latte ×32, matcha ×31, …). Cluster by drink family (latte/matcha/choc/specialty/food) — ~6 groups, not per-SKU (long tail; skip oddities like "iced water").
- **Anti-spam (global):** suppress anyone in `loop_assignments` (any loop) OR `sms_logs` within 14 days.
- **Offer = favourite as HOOK, not a discount on what they already buy** (that erodes margin): "free [your favourite] when you spend RM20+", or B1F1, time-boxed to the weak round.
- **Holdout:** don't tag the 10% control → they can't redeem → clean lift measurement.
- **Dynamic:** each cycle, read the weakest OPEN round per outlet from rolling data (dashboard already computes vs-target) → target follows.

## Approaches Considered
### A — Wedge (days): one round, one outlet, soft pace
Pick the single weakest **open** round at one outlet. Tag the eligible pool (≤100/day), time-gated tag-restricted promo on the favourite, SMS personalised, 10% holdout, measure the round's lift. Pool ≈245 → ~3-day burst. Proves P2 + P3.

### B — Medium (weeks): dynamic, multi-round, all outlets
Auto-detect weak open rounds per outlet; per-round personalised promos; daily cap; full dashboard. Build only after A moves a needle.

### C — Full (months): personalisation engine
Favourite-affinity service, per-member offer optimisation, auto-tuned timing + offer per person. Premature.

## Recommended Approach
**A.** Smallest thing that tests "does a personalised, time-boxed nudge move a weak round." Everything in B/C is a multiplier on A — and a multiplier on an unproven base is zero.
*Flip to B* only if A shows ≥3pp incremental order-rate lift on the round vs holdout and positive ROI.

## Open Questions
- Which outlets are actually open at Evening/Dinner/Supper? (P1 — blocks everything.)
- Favourite by product vs by drink-family cluster for the offer?
- Does pacing ≤100/day matter when the pool is only ~245, or just send the burst + measure?

## Success Criteria (measurable)
- Treated vs 10% holdout: **≥3pp** higher order-rate in the target round over a 14-day window, **positive incremental margin** net of SMS + reward COGS.
- No spam complaints / opt-out spike (<2% opt-out among treated).

## The Assignment (one concrete next step)
**Before any code:** confirm, per outlet, the actual open hours and whether anyone is staffed/serving at Evening / Dinner / Supper. Rule out "closed" vs "weak." If Supper is closed, drop it — no loop can fix a shut door. Bring back: which (outlet × round) pairs are genuinely open-but-underperforming. That list is the real target set.
