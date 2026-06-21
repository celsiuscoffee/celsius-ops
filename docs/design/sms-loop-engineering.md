# SMS Marketing Loop Engineering

_Office-hours diagnostic — 2026-06-21. Owner: Ammar._

## Problem Statement
Celsius can now reach ~20.8k members by SMS (SMS Niaga live, deliverability fixed). But it has **never proven an SMS drives an order**. Repeat rate is **20.1%** (4,413 one-and-done vs 1,110 repeat). "Marketing" to lapsed customers today = ad-hoc, untargeted, unmeasured blasts fired when the owner remembers. Goal: an engineered, **measured** loop that systematically lifts repeat orders — starting by proving the core assumption rather than scaling on faith.

## Objective (owner directive 2026-06-21)
SMS marketing optimizes **visit FREQUENCY** — reactivate the lapsed and pull infrequent visitors into more visits. **AOV/basket is explicitly OUT of scope for SMS** (it stays at the POS via pair-suggest). Single North-Star metric for every loop here: **incremental orders per member per period, measured against a holdout.** Reactivation (0 → ≥1 order) is the extreme, cleanest case of frequency; build it first.

## Demand Evidence
**Strong (proven) + migration-driven.** The dashboard was **StoreHub Engage** — StoreHub's built-in SMS marketing — where the owner ran real automated campaigns: Win Back Lost Customers (1,748 reach / 248 returning), Welcome New Members (421 / 68), Birthday Promotion (429 / 78), plus a custom one-time blast (3,169 reach). Money spent + campaigns actually run = the strongest demand signal there is. **And StoreHub is being cancelled** (see storehub→POS-native migration) — so this engine is about to be switched off. Internalizing it isn't greenfield; it's replacing a live capability before it disappears.

Caveat on the tool's reported numbers: its RM19.9k "revenue generated" / **41–62× ROI is naive attribution** (all post-SMS spend counted, no control group) — overstated, not trustworthy as incremental lift. And within the Celsius DB, no honest (holdout) attribution has ever been measured. So demand is proven; *causal effect size is still unknown*.

## Status Quo (what happens now)
**Was** a paid external SMS tool running these campaigns; now lapsed back to ad-hoc manual blasts. The external tool is the real competitor to beat. Owner stopped / wants in-house for **three specific gaps** (owner-confirmed):
1. **No loyalty/reward link** — it couldn't issue Celsius rewards, tag them to a phone, or tie into points/tiers/missions.
2. **Untrustworthy numbers** — inflated ROI, no real attribution.
3. **Not unified** — segmentation/sending/rewards/attribution split off in a separate tool, not native to the app.
(Cost was NOT a reason — SMS Niaga at RM0.10 is already fine.)

These three gaps ARE the in-house value proposition. If the build doesn't close all three, re-subscribing to the external tool is the rational choice.

## Why in-house wins (must close all 3)
- **Reward-linked:** auto-issue a Celsius loyalty reward tagged to each recipient's phone/member record (`issued_rewards` / `manual-grant` / `admin_claimables`), redeemable at POS/pickup, tied to points/tiers. ← the owner's "tag reward to phone (automate)" requirement.
- **Honest attribution:** holdout control + `redemptions`/orders tracking → true incremental lift, not the external tool's vanity ROI. **Redemption of the tagged reward is the cleanest causal signal** (they claimed *this* campaign's reward).
- **Unified:** segment from `members`/`orders`/`pos_orders`, send via SMS Niaga, issue reward, track redemption — all in the backoffice.

## Target User (named)
**Ammar (owner).** Fires sends himself today. Needs: take it off his plate, **stay in control** (approve-gated, e.g. Telegram per the Marketing AI Agent scope), and get **a number he trusts** — RM spent vs incremental orders/margin. Keeps him up at night: paying for marketing that may do nothing.

## Narrowest Wedge
**One** win-back loop: segment = one-and-done, last order 30–60 days ago; **one** margin-safe offer (loyalty lure, NOT a cash discount); random **20% holdout**; measure order-rate lift treatment vs holdout over 7 days; approve-gated single send. Output = the first honest attribution number.

## Premises (explicit assumptions)
- SMS reaches the lapsed; in-app/POS structurally can't. (true now)
- A **holdout control is the only honest attribution** — naive before/after is confounded by seasonality + regression-to-the-mean.
- **Margin-safe lures** (expiring points, "1 visit from Gold", free low-COGS drink, mystery reveal) beat discounts. North Star: discounts are last resort.
- Cost: 4,413 × RM0.10 ≈ **RM441/full send**; cheap to test once, expensive to spray on cadence — hence attribution-first.
- **Phone is the join key**: `members.phone` → `orders`/`pos_orders` for attribution; `sms_logs` records the send.

## Loop Portfolio & Engine (owner direction 2026-06-21)
The shared **engine** is what makes these "loops": every campaign runs as **holdout + N offer arms → measure incremental conversion (redemption + order) per arm → shift budget to winners → repeat.** Champion-challenger: offers compete, winners scale, losers retire.

- **Win Back — flagship loop (MULTI-ARM):** the owner's "test which converts most" = the point of looping. Eligible = lapsed (30–60d, then 60–90d). Each round: 10–20% holdout + 2–3 reward arms, reward auto-tagged to phone. **Arms = A: Free Tea (cheap foot-in-door, max reactivation) vs B: B1F1 drink (purchase-required, max revenue per reactivation); optional C: Free Coffee (richer freebie) if volume allows.** (2× points dropped — too low-salience for a lapsed customer; `buy1free1` is already a reward type, used by Birthday.) Arms sit at different points on the cost/commitment curve, so the winner depends on the metric → track BOTH reactivation rate AND incremental margin per recipient; **rank by incremental margin per recipient** so a money-losing freebie never scales. Reallocate next round to the winner, retire losers, add challengers. This is **Loop #1**.
- **Weekly round-gap loop:** ties marketing to ops. Each week compute actual-vs-target per outlet × **round** (day-part). Pick the biggest shortfall (e.g., Putrajaya evenings −30%). Target that outlet's customers who don't usually come in that round; nudge them to it (round-timed reason/reward). Measure that round's lift vs prior weeks / holdout. **Loop #2.**
- **Birthday:** **Free Drink**, fixed reward, always-on, low volume. A/B the message only.
- **Welcome (recommended next):** 1st→2nd-visit conversion sequence — the biggest structural lever (80% one-and-done). 1–2 timed messages + reward after first order.
- **Others (later, same engine):** points-expiry ("use it or lose it"), tier-progress ("1 visit from Gold"), frequency/streak (slipping cadence), replenishment (per-member next-order timing).

**Statistical reality (honesty):** multi-arm needs volume — roughly hundreds of recipients per arm to read a 3–5pp difference. Start Win Back with **2–3 arms, not six**; read when enough conversions land, not on a fixed clock; never split a small segment into many arms.

**Sequencing:** build the engine via **Win Back multi-arm first** (proves looping + honest attribution) → Weekly round-gap → Welcome → the rest. Not all at once.

## Approaches Considered

### Approach A — One reward-linked win-back loop + holdout (days) — RECOMMENDED
Single segment (one-and-done, last order 30–60d), single **margin-safe loyalty reward auto-issued + tagged to each treatment member's phone** (`issued_rewards`, expiry-dated), SMS via SMS Niaga referencing the reward, 20% random holdout (no reward, no SMS), approve-gated. Attribution after 7d: **redemption rate** (treatment claimed the tagged reward) + order rate, treatment vs holdout; incremental orders × margin − SMS cost. Reuses members query + loyalty blast route + reward-issuance primitive + `sms_logs`/`redemptions`. Deliverable: the first *honest* go/no-go number — and proof the reward-tag→redemption pipe works end to end.

### Approach B — The loop engine (weeks)
3–4 segments (one-and-done, at-risk regular, high-value lapsed, points-expiring) on cadence via the existing `campaigns-auto` cron, **each with a built-in holdout**, plus suppression (don't re-hit recent orderers), frequency caps, PDPA Reply-STOP, and a backoffice **attribution dashboard** (per-segment/per-message lift, RM vs incremental margin, repeat-rate trend). Weekly approve-gate.

### Approach C — Marketing AI Agent (months)
The already-scoped margin-aware proposer auto-designs segments/offers, predicts lift, **learns from accumulated holdout data**, unifies win-back + frequency + AOV (POS pair-suggest) loops, lights idle channels (app/POS posters + SMS), Telegram approve-gated.

## Recommended Approach
**A.** No attribution data exists, so A produces the single number that decides whether B and C are worth anything. It's cheap (~RM350–440), days of work, mostly existing pieces. Build the holdout + attribution **once**, on one loop. Flip to B-first only if the measurement scaffolding generalized to N segments at zero extra cost — it doesn't; the discipline lives in the holdout/attribution, not the segment count.

## Open Questions
- Exact offer for loop #1 (which margin-safe lure)?
- Success bar: minimum order-rate lift over holdout worth scaling? (propose ≥3–5 percentage points)
- Attribution window — 7 or 14 days?
- PDPA: confirm Reply-STOP / opt-out handling with SMS Niaga + suppression list.
- Holdout size — 20% default OK?

## Success Criteria (measurable)
- Loop #1 ships one approved send with a **logged holdout group** and a **reward auto-tagged to each treatment member's phone**.
- 7 days later: treatment vs holdout **order rate AND reward-redemption rate**, with RM (SMS + reward COGS) vs incremental margin.
- A decision is **recorded** (scale / kill / iterate). The trustworthy number — not the send — is the deliverable.
- Closes the 3 gaps: reward-linked ✓, holdout-honest ✓, native/in-app ✓.

## The Assignment (one concrete next step)
Decide two things only you can: (1) loop #1's **exact reward** to auto-tag (recommend a low-COGS drink, expiry-dated — NOT the old RM5 cash discount), and (2) the **success bar** (min order/redemption-rate lift over holdout worth scaling; propose ≥3–5pp and margin > spend). Optional: **export the old external tool's campaign data** so we can benchmark our honest numbers against its inflated ROI. Then I wire the holdout split + reward auto-issue + attribution.
