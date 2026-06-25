# SMS Loop — Goals & Metrics (hard rules)

_Rebuild of the goals/metrics layer for the Celsius SMS marketing loop. Owner: Ammar. Date: 2026-06-25._
_Builds on [`sms-loop-engineering.md`](./sms-loop-engineering.md) and [`personalised-round-gap-loop.md`](./personalised-round-gap-loop.md). Every metric below maps to a real column in `loop_rounds` / `loop_assignments` / `sms_logs` (migration `038_sms_loops.sql`, `005_sms_logs.sql`) so it is queryable, not aspirational._

## 0. The one rule everything hangs on

**No number counts unless it is measured against the holdout.** Naive before/after is banned (it's how the old StoreHub tool got a fake 41–62× ROI). Every lag metric is `treatment − holdout`. If a round shipped without a logged holdout (`loop_assignments.arm = 'holdout'`), it produced **zero** trustworthy numbers, regardless of how good the raw conversion looked.

North Star (unchanged): **incremental orders per member per period, vs holdout.** SMS optimizes visit **frequency**, not basket — AOV stays at the POS.

---

## 1. LAG GOAL — "return spending / redeem" (the outcome)

Lag = the result. You can't move it directly; it's what the lead activity produces. Measured per round at `measured_at`, written to `loop_rounds.stats`.

| # | Metric | Formula (real fields) | Hard rule / bar |
|---|--------|----------------------|-----------------|
| L1 | **Incremental Conversion Rate (ICR)** — *the primary lag metric* | `conv_rate(treatment) − conv_rate(holdout)`, where `conv_rate = count(converted=true) / count(arm)` within `attribution_window_days` | **≥ 3pp = iterate. ≥ 5pp = scale. < 0 or n.s. = kill.** This is the go/no-go number. |
| L2 | **Reward Redemption Rate** — cleanest causal signal | `count(reward_redeemed=true) / count(treated)` per arm | Track always; redemption = they claimed *this* round's reward, so attribution is unambiguous. No fixed bar (read alongside ICR); the redeemed-vs-incremental gap is formalised as L6 in §1B. |
| L3 | **Incremental Margin per Recipient (IMPR)** — *the ranking metric* | `(incr_orders × margin_per_order − reward_COGS_redeemed − sms_cost) / count(treated)` per arm | **MUST be > 0 to scale. Arms are ranked by IMPR, not by ICR** — so a high-conversion money-losing freebie never wins. |
| L4 | **True ROI (holdout-based)** | `incremental_margin / (sms_cost + reward_COGS)` per round | Reported for the owner's "a number I trust." Replaces the banned naive ROI. Scale bar: **> 1.0** (margin exceeds spend), comfortably **≥ 2×** to prioritise budget. |
| L5 | **Program repeat-rate trend** | brand repeat rate over time (repeat members / total) — baseline **20.1%** (1,110 / 5,523) | The slow-moving scoreboard the whole loop exists to move. Directional, quarterly. |

**SMS cost** = recipients × RM0.10 (SMS Niaga). **margin_per_order** = owner-supplied gross margin %; until supplied, use a conservative placeholder and flag it.

### Definitions (read — these are NOT raw treatment numbers)

The benefit side of every lag metric is **net of the holdout**. "Orders" never means treatment orders alone — it means treatment orders *minus* what the holdout did anyway:

```
conv_rate(arm)     = count(converted=true in window) / count(arm)         # per arm
incremental_orders = (conv_rate(treatment) − conv_rate(holdout)) × N_treated
incremental_margin = incremental_orders × margin_per_order
```

The holdout is a **random** slice of the *same* segment that gets **no SMS and no reward**. Its order rate is, by construction, the "they'd have come without the trigger" rate — so subtracting it is exactly how we throw away orders the SMS didn't cause. A treatment member who would have ordered anyway is cancelled out by an equivalent holdout member; only the *difference* is credited to the SMS. If a round has no holdout, `incremental_orders` is undefined — you're back to naive attribution (see §0).

Cost, by contrast, is **actual**: SMS is charged on everyone sent; reward COGS is charged on every redemption (`reward_redeemed=true`), incremental or not.

---

## 1B. Reconciling redemption vs holdout (which "real" number to trust)

Two honest-looking signals, measuring different things — this section says how they fit together so we never double-count or fool ourselves.

- **Redemption** = per-person proof. Claiming *this* round's reward means the SMS provably reached and motivated that individual. No holdout needed to attribute one redemption.
- **Holdout incremental orders** = population-level causal truth (`treatment − holdout`), but never knowable per person.

A redemption is one of two things the holdout can tell apart in aggregate but a redemption count alone cannot:
1. **Incremental redeemer** — wouldn't have come without the SMS. A real win.
2. **Subsidised redeemer** — was coming anyway and took a free reward en route. You paid COGS for an order you'd have had for free — a margin leak, *not* effectiveness.

And redemption misses a third group entirely: **halo orders** — SMS reminded them, they came and ordered, but never used the reward (forgot it, missed min-spend, bought something else). Real incremental business, zero redemption.

**So redemption is NOT the ROI numerator.** Setting `ROI = redemptions × margin / cost` counts the subsidised redeemers as wins — that is the StoreHub over-attribution bug wearing a redemption costume. The honest split (already how L3/L4 are written):

- **Benefit → from the holdout** (`incremental_orders`): subsidy contributes nothing, halo is correctly counted.
- **Cost → from redemptions** (`reward_COGS × redeemed`): you really did pay COGS on every claim.

### The reconciliation as a watched metric

| L6 | **Redemption incrementality** | `incremental_orders / redemptions` per arm |
|---|---|---|

| Value | Meaning | Action |
|---|---|---|
| ≈ 1.0 | reward is the mechanism; clean, tight attribution | trust redemption as a fast proxy |
| ≪ 1.0 (e.g. 0.4) | **subsidy leak** — most redeemers would've come anyway | offer too generous / wrong segment; tighten or cut |
| > 1.0 | **halo** — SMS drives visits beyond the reward | reward almost incidental; try a cheaper / no offer |

### Which number to lean on depends on the segment's baseline

This is the practical rule:

- **Win-back / lapsed (low holdout order rate):** the holdout barely orders, so nearly every redemption *is* incremental → redemption ≈ incremental. Redemption is a fine, fast proxy; you can read results before the noisier holdout math settles.
- **Active / round-gap / frequency (high holdout order rate):** the holdout orders a lot anyway, so redemptions massively overstate effect (lots of group 2). Redemption-only ROI here is the StoreHub trap — you **must** use the holdout.

Rule of thumb: **redemption tells you the loop *works*; the holdout tells you it *paid*. The higher the segment's natural visit rate, the more you lean on the holdout.**

---

## 2. LEAD GOALS — the controllable inputs (who / what / when)

Lead = predictive + influenceable. These are the levers you actually pull each round. Each has **gates** (hard rules enforced in code before a send) and **measures** (did we do the lead activity well).

### 2A. WHO — segment / targeting

**Gates (a member is ineligible unless ALL pass):**
1. **Reachable** — valid MY mobile (`60…` after normalize), `sms_status` not previously `failed`-hard, and **not opted out** (no Reply-STOP).
2. **Frequency cap** — not in any `loop_assignments` row in the last **14 days**, and not in `sms_logs` in the last **14 days**. (Global anti-spam across every loop, not per-loop.)
3. **Segment match** — meets the loop's own definition, e.g. Win Back: `≥1 order` and `last_order` 30–60d (then 60–90d); Round-gap: has a clear favourite, visited ≤60d, ≥2 visits, **does not already visit the target round**.
4. **Min pool** — eligible pool ≥ **(min sample per arm) × (arms + holdout)**. If the pool can't fill the arms, **drop arms, don't split thin** (see §3).

**Measures:**

| Metric | Formula | Bar |
|--------|---------|-----|
| Targeting precision | `% treated who actually matched the intended segment at send time` | ≥ 98% (mis-targets = a query bug) |
| Suppression rate | `% of raw candidates removed by gates 1–2` | Monitor; a sudden drop = a leak in the frequency cap |
| Pool coverage | `eligible_pool / theoretical_segment_size` | Informational — shrinking coverage = list fatigue, loosen criteria or wait |

### 2B. WHAT — offer (promo / cost / effectiveness)

**Gates:**
1. **Margin-safe by default** — reward is a low-COGS lure (expiring points, free low-COGS drink, B1F1), **not a cash discount**. Discounts are last-resort and must be flagged.
2. **Offer cost ceiling** — `reward_COGS_per_redemption ≤ 40%` of expected incremental margin per redeemed order. An offer that can't clear this can't run.
3. **Champion-challenger** — every round runs **holdout + ≥2 arms** (`loop_rounds.arms`). No single-arm "blast" — that learns nothing.
4. **Retire rule** — any arm with **IMPR < 0** over a measured round is retired; the IMPR-winner becomes next round's champion; add one new challenger.

**Measures:**

| Metric | Formula | Bar |
|--------|---------|-----|
| Redemption rate per arm | `redeemed / treated` per arm | Compare arms; low = weak hook or friction |
| Cost per incremental order | `(sms_cost + reward_COGS) / incremental_orders` per arm | Lower is better; must stay < margin_per_order |
| Offer win margin | `IMPR(winning arm) − IMPR(runner-up)` | Needs to beat noise (see §3) before declaring a winner |

### 2C. WHEN — trigger / timing

**Gates:**
1. **Data-defined trigger, never "when the owner remembers."** Each loop has an explicit machine condition: Win Back = `last_order` in window; Round-gap = weakest **OPEN** round per outlet from rolling data; Birthday = DOB today; Points-expiry = points expire ≤ N days; Welcome = first order placed.
2. **Send-time window** — sends only **11:00–20:00 MYT** (PDPA courtesy + open-for-business). Never overnight.
3. **Open-round rule** (round-gap) — never target a round the outlet is closed/unstaffed for. "Texting people to a locked door" is the highest-risk failure (P1).
4. **Cadence cap** — a loop fires at most its defined cadence; combined with the 14-day per-member cap in §2A.

**Measures:**

| Metric | Formula | Bar |
|--------|---------|-----|
| Automation rate | `% sends fired by trigger vs manual` | → 100% (manual ad-hoc blasts are the thing we're killing) |
| Send-time compliance | `% sends inside 11:00–20:00` | 100% (gate, so any miss is a bug) |
| Trigger freshness | lag between trigger condition true and send | Within cadence; stale triggers = wasted relevance |

---

## 3. GUARDRAILS & "other factors" (suggested additions)

These aren't who/what/when — they're the safety rails that stop the loop from quietly lying or doing harm. Several are kill-switches.

| Factor | Metric | Hard rule |
|--------|--------|-----------|
| **Opt-out / PDPA** | Reply-STOP rate among treated per round | **< 2%. Above 2% = pause that loop.** Opt-outs are permanent and append to the suppression list. |
| **Deliverability** | `delivered / sent` from `sms_logs.status` | < ~90% = gateway/sender-ID problem; investigate before next send. |
| **Holdout integrity** | holdout exists, `holdout_pct` 10–20%, never messaged, never tagged | Non-negotiable. A round with no holdout is unmeasured by definition (§0). |
| **Statistical power** | min sample per arm to read the target lift | ~**hundreds per arm** to detect a 3–5pp difference. **Read on conversions landed, not on a calendar.** Never split a small segment into many arms. |
| **Cannibalisation** (round-gap) | peak-round (Lunch/Midday) volume during the campaign vs prior weeks | Lift on the weak round must not come from shifting peak demand — net it out. |
| **Attribution window** | fixed `attribution_window_days` per loop | Pick **7 or 14d once** and hold it constant across rounds, or rounds aren't comparable. |
| **Budget** | RM spent per round (recipients × RM0.10 + reward COGS) | Per-round ceiling set before approval; full one-and-done send ≈ RM441. |
| **Decision logged** | each round records scale / kill / iterate | The trustworthy number + a recorded decision is the deliverable, not the send. Write to `loop_rounds.stats`. |
| **Member fatigue (long horizon)** | per-member sends/quarter; trend in opt-out & deliverability | Rising opt-out / falling redemption across rounds = the list is tiring; widen rest period. |
| **Time-to-repeat (longer signal)** | median inter-visit gap for reactivated members | Did a reactivation stick, or was it a one-off redemption? Distinguishes real frequency lift from coupon tourists. |

---

## 4. The scoreboard (what to actually watch)

- **Per round (operational):** ICR (L1), IMPR per arm (L3), redemption per arm (L2), redemption incrementality (L6), opt-out %, deliverability, decision.
- **Per loop (champion-challenger):** which arm is champion, IMPR trend, pool coverage.
- **Program (strategic, quarterly):** repeat-rate trend (L5), true ROI (L4), total incremental orders & margin.

Lead metrics (§2) are the ones reviewed **weekly** — they predict the lag. If automation rate, targeting precision, and offer/holdout discipline are green, the lag follows. If the lag is flat but the leads are green, the *premise* (SMS moves frequency) is wrong — and that's the real thing to learn.

---

## 5. Open decisions (owner)

Carried from the engineering doc, now framed as metric thresholds to ratify:
1. **Scale bar** — confirm ICR **≥ 5pp** and IMPR **> 0** as the scale gate (proposed).
2. **Attribution window** — **7d or 14d**? Lock one.
3. **Holdout %** — **20%** default OK, or 10% to send more treatment?
4. **margin_per_order** — supply the real gross-margin number so L3/L4/offer ceiling stop using a placeholder.
5. **Opt-out kill threshold** — ratify **2%**.
