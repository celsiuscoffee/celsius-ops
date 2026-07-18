# Grant-time loop engineering (rewards module)

_Scoped + built 2026-07-02. Extends docs/design/sms-loop-engineering.md to rewards the app HANDS OUT._

## Problem
The SMS loop engine measures every outbound campaign (holdout + arms + honest attribution), but the rewards module itself — mission completions, mystery drops, milestones — hands out fixed, hand-picked rewards with zero measurement. Nobody knows whether "Free Pastry" vs "Beans Boost" on a completed mission changes return-visit rate at all.

## Design
**Grant loops** reuse the SMS engine's tables + measurement wholesale; only the assignment moment differs.

- **Assignment at grant time, not blast time.** `@celsius/shared` `assignGrantArm()` (packages/shared/src/loyalty/grant-loop.ts) is called by the order app the moment a reward is about to be issued. It enrols the member in the loop's current round, logs a `loop_assignments` row (`channel='grant'`, no SMS), and says which voucher template to issue.
- **Rolling rounds.** A round (status `'open'`) accumulates assignments for `roundDays`, then closes to `'sent'` — lazily on the next grant, or by `autoMeasureDueRounds` as a backstop. From there the existing measure flow (`measureRound`, pooled baselines, leaderboard, evaluation) runs unchanged.
- **Control ≠ no reward.** You can't hold an earned reward out of a mission completion. The control arm is stored under the engine's `'holdout'` key but receives the **status-quo reward** (the mission's own configured voucher). Lift reads "treatment reward vs what we hand out today" — the honest baseline for a grant. `measureRound` skips holdout-contamination exclusion for grant rounds (sibling SMS lands on control and treatment symmetrically).
- **Fail-open.** Any error in the experiment plumbing (no phone, race, settings typo) falls back to the status-quo reward with no assignment logged. Experiments must never break fulfilment. A treatment template that fails to issue falls back to the mission default and re-files the assignment as control, so arm stats only contain members who actually got the arm's reward.

## Loop #1: mission_reward
- Hook: `fulfilCompletedAssignment` in apps/order/src/lib/loyalty/v2.ts.
- Split: 50% control (mission's own voucher) / 50% challenger.
- Default challenger: **Free Coffee** (`206b5fbf-…`) — the same low-COGS, visit-driving lure the birthday loop uses.
- Arms are owner-tunable without a deploy via `app_settings.mission_reward_loop_arms` (JSON `[{key,label,voucher_template_id}]`); arms freeze onto each round at creation.
- Window: 7-day rounds, 14-day attribution. Metric: conversion (any order) + redemption + revenue per recipient vs control, in the existing campaigns scorecard.
- Missions with no configured voucher are excluded (no status quo to compare).

## Known gaps (accepted for the wedge)
- The live (pre-measure) rollup RPC counts `sms_status='sent'` rows, so grant loops show 0 "sent" until measured; the measured scorecard is the real read.
- `loop_assignments.issued_reward_id` is single-column: a control grant that issues several vouchers attributes redemption of the first.
- Next candidates on the same rails: mystery-pool variants (arm = pool), welcome/milestone reward choice.
