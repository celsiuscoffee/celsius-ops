# Ads Spend Autopilot

_Built 2026-07-16/18 across PRs #947, #952, #954, #971, #972, #973 (all merged).
Live in production since the 2026-07-17 nightly run. Code:
`apps/backoffice/src/lib/ads/{autopilot,term-rules,pause-campaign}.ts`, wired
into `cron/ads-daily`. Kill switch: `agent_registry` key `ads_autopilot`
(Settings → System → AI Agents; fail-safe off if the row is missing;
shadow = decide + log, mutate nothing)._

## Target (owner, 2026-07-19 — revised same day)

**+RM5,000/month net cash, from Google Ads ONLY.** (Original ask was RM7k
from ads and/or sales loops; SMS/loyalty was proposed and PARKED — owner: "i
want the cash incremental only from gads first" → "lets do 5k then".)
Scored EVERY night by `cashScoreboard()` and logged with the run (agent's
last-action line + `agent_actions.meta.scoreboard`): cuts side =
(RM300.20/day pre-descent fleet budget − current fleet budget) × 30; sales
side = (recent 14d fleet till/day − pre-descent anchor till/day) × 60%
margin × 30 — a NET drift measure; a till decline counts negative. RM5k is
reachable from cuts alone if the descent runs deep (ceiling ≈RM6.4k/mo at
the RM20 floors); the in-channel stretch levers if it stalls are the
value-based Pickup Order conversion tag and the probe-up phase.

## Objective (owner directives, 2026-07-16→18)

Maximize **cash = incremental till revenue × gross margin − ad spend**, with
the till (unified sales sources) as the only source of truth — Google's
conversion counts (directions-clicks/calls) are never trusted as an objective.
No per-change human approval. Trim first; then find the spend that increases
cash. Descend from current budgets (100% → lowest), never rebuild from zero.
Burden of proof is asymmetric in cash's favor: **a cut stands unless the till
proves it hurt; a raise reverts unless the till proves it helped.**

## Control loop (nightly, actions self-paced)

Runs every night inside ads-daily right after the sync (3am MYT). Cadence
lives in the controller, not the cron day: per-campaign observation windows
pace disturbances, a 6-day fleet-wide stagger keeps a ~weekly rhythm, and
safety actions (rollback / revert / restore) fire the first night the till
calls for them. Per-campaign state machine whose memory is the
`ads_budget_change` ledger's reason prefixes (`autopilot step-down|rollback|
raise|revert|pause|restore`) — no extra tables.

### Exclusions (every night, before budget decisions)

`term-rules.ts` buckets every matched Smart-campaign search term:
- **Auto-excluded**: own brand, non-café food intent (incl. Malay/local:
  restoran, kedai makan, makanan, food court, warung, gerai, 美食…),
  competitor brands (owner 2026-07-18: no conquesting — Zus, Kenangan,
  Luckin, ZUS-class chains + locals like Hock Kee, Kopihut, Cotti, Vinyl
  Cafe, Qbistro, Hainan Kopitiam, Temu Coffee), dessert/bakery.
- **Never excluded**: café/coffee/breakfast intent, unknowns ("other" ≠
  useless). Human `rejected` ledger rows are a standing no; `failed` rows
  retry.
- **Broad ROOTS, added alongside literals (2026-07-21, corrected 2026-07-23):**
  exclusions are written as broad negative-theme roots
  (`negativeThemeRoot`/`exclusionPhrase` in term-rules) — "zus" not "zus near
  me", "coffee bean" not "coffee bean shah alam". One root covers many variants
  and pre-blocks future ones, using fewer of the ~25 negative slots.
  `selectAutoExclusions` groups spend by root and sums it; seeds emit roots too.
  `consolidateCampaignNegatives` (armed nightly pass) adds roots **additively**
  and takes only genuinely free slots. Root lists never overlap café intent
  ("coffee bean" is a brand; bare "coffee" is deliberately absent).
  **A root NEVER removes the literal it appears to subsume** — see the Jul 21
  regression below. Slot pressure is resolved by value-ranked eviction
  (`planSlotSwap`), which drops the least valuable negative measured by the
  junk it actually covers (`scoreNegatives`), not the one that looks redundant.
- **Post-apply verification (2026-07-23, `verify-exclusions.ts`):** every night
  `findLeaks` checks whether each applied negative is actually blocking — any
  term still being paid for >2 days (propagation grace) after its covering
  negative went live is a LEAK, and the offending literal is re-excluded in its
  own right, evicting the cheapest incumbent if the campaign is full. This is
  empirical rather than another guess about Google's matcher, so future
  surprises (plurals, accents, transliterations) self-correct. `superseded`
  ledger rows are retryable (they are no longer on Google), which is how a
  wrongly-removed literal gets back in.
- **Slot budget**: `MAX_NEGATIVES_PER_CAMPAIGN=25`, highest measured cost
  first (≥RM2/30d summed per root, ≤15/campaign/run); seeded roots fill
  leftover slots. **Why this was needed:** by 2026-07-21 all three campaigns
  hit 25/25 on literals with junk still un-excluded — consolidation freed the
  slots.
- Google negative THEMES match related searches (fuzzy) — e.g. "kopitiam
  near me" is collateral of the kedai-makan/restaurants themes. Monitor
  café-intent impressions.

### Budget state machine

- **WASTE-MATCHED CUT** (same run as its exclusions; paired bookkeeping, not
  an experiment): removes exactly the measured daily spend of exclusions not
  yet taken out of the budget (min RM0.50/day, ≤20%/cut). Exempt from
  observation windows / stagger / cut cap; still gated by the guard, the
  floor, and rollback coverage.
- **DESCEND**: once no unpaid waste remains, blind step-down **12%** (18% when
  cost/conv >1.3× fleet-best), ≥14d observation PER CAMPAIGN, max **3** cuts/run,
  **3d** fleet stagger, floor RM20/day. Aggression bumped 2026-07-19 (owner:
  "decrease more") after the first cuts proved safe; all four env-tunable
  (`ADS_STEP_PCT`, `ADS_STEP_PCT_INEFFICIENT`, `ADS_MAX_CUTS_PER_RUN`,
  `ADS_FLEET_SPACING_DAYS`, `ADS_AUTOPILOT_FLOOR_MYR`). OBSERVE_DAYS stays 14
  (= guard window) so no single campaign outruns its own measurement.
- **GUARD**: last 14 full days actual till ÷ same-window forecast (labour
  gate's per-weekday recency-weighted forecaster; history precedes the
  window = clean counterfactual), ÷ median of the other ads outlets' indexes
  (cancels fleet shocks), plus a fixed **anchor** — share-of-fleet revenue
  now vs the 28d before the first ledgered change (<0.93 = breach; catches
  slow damage the trailing forecast normalizes away). Breach = raw <0.95 or
  fleet-adj <0.97 or anchor <0.93. **No guard signal → never act.**
- **ROLLBACK** on breach after a recent cut — but only within the
  **plausibility bound** (#972): the ringgit gap (worst index ×
  `forecastDailyMyr`) must be ≤ cumulative descent ÷ margin
  (`ADS_GROSS_MARGIN`=0.6) × 2. Implausibly large gaps hold-and-flag
  "another cause" instead. Rollback restores one step + 56d hold.
- **PAUSE PROBE** — SHELVED by owner 2026-07-19 ("let tamarind follow the
  others"); machinery kept, re-enable via ADS_AUTOPILOT_PAUSE_PROBE=on.
  (Design: the till-readable experiment: steps of 8–15% of
  ~RM100/day move a ~RM2.5-3k/day outlet by <1% — unreadable; a full pause
  ≈5-6% if break-even): one clearly-inefficient campaign at a time
  (cost/conv >1.3× fleet-best, never re-probed), paused 28d via the Ads API,
  others keep descending as controls. Blocks only on **absolute** weakness
  (own raw index <0.95); a relative-only breach (hot sibling) does not defer
  it (#973). Auto-restore with verdict vs a pre-pause forecast: till dropped
  → ads generate cash, resume prior budget + descend; no detectable effect →
  below break-even wholesale, restore at the floor.)
- **PROBE UP** (the "increase cash" search, entered after a rollback proves
  response): +15%, 28d observation, cap 1.25× highest ledgered baseline;
  kept only on detectable lift (fleet-adj ≥1.02 AND raw ≥1.0), breach
  reverts immediately; no lift → **REVERT → SETTLE** 90d at the proven
  optimum, then re-search.

Every action lands in `ads_budget_change` / `ads_term_exclusion` as
`decided_by='ads-autopilot'` (undo paths on `/ads/optimizer` unchanged) plus
a summary row in `agent_actions`. Human-paused campaigns are left alone.

## Verified findings along the way

- Google's tracked "conversions" are Directions + Calls (per-action sync
  stale since 2026-04-19); the value-based Pickup Order tag
  (`ads-conversion-loop.md` Approach A) is STILL unwired — open owner
  decision.
- Putrajaya term audit (15d): 63% café intent, 20% non-café food, 13%
  competitor brands, 4% dessert, 1% own brand.
- Search-terms sync originally died after the first account (serial upserts
  vs pool/maxDuration) — only Putrajaya had data; fixed with batched unnest
  upserts (#947). SA/Tam history accumulates from Jul 17.
- **Tamarind rollback false positive (Jul 18)**: first run rolled Tamarind
  84.96→100.20 on fleet-adj 0.94 — channel decomposition showed the till
  FLAT in absolute RM (2,197→2,211/day, Grab flat); breach was a
  trend-extrapolating forecast + SA running hot, and the blamed RM15/day cut
  could not produce a ~RM138/day gap. Led to the plausibility bound and the
  absolute-vs-relative probe gate.
- Merging is not deploying: the Jul 16 cron ran pre-autopilot code because
  the prod deploy lagged the merge ~6h. Verify the Vercel prod deployment is
  READY when a merge must beat a cron.

## Effect (updated 2026-07-23 — earlier claim corrected)

Owner drove the descent hard over Jul 19–20 ("decrease more" → "how can we do
this faster" → hard-cut to RM55). **Actual state:** fleet at **RM158.46/day**
(PJ 51.51 / SA 53.98 / Tam 52.97) from a RM300.20/day pre-descent baseline —
a ~47% cut. Autopilot has held since Jul 22, in its 14d observation window.

**The Jul 21 claim ("till held flat, cuts banked RM4,056/mo = 81% of target")
was overconfident. Two confounds surfaced on Jul 23:**

1. **SMS masked the till.** Decomposing the flat top-line by discount status
   (clean post-cutover, cut-week vs the 4 weeks before): **organic** (no
   discount) till fell RM8,628 → **RM8,495/day (−1.5%)** while **discounted**
   (SMS-voucher) till rose RM1,459 → **RM1,690/day (+16%)**. The headline was
   flat only because the two moved in opposite directions — the ad-exposed
   half did soften. Both levers were changed in the same window, so neither is
   cleanly attributable.
2. **The guard is blind to this.** It reads TOTAL till, which the SMS loop
   inflates, so it cannot detect ad-cut damage while SMS ramps. **Fix owed:
   point the guard and scoreboard at organic (non-discounted) till.**

**Honest cash range: +RM1.8k to +RM4.25k/mo**, not a settled RM4.25k. Lower
bound = RM142/day saved − up to RM133/day organic gross (≈RM80/day margin).
The true figure sits inside that band because part of the organic "decline" is
cannibalisation (a walk-in who now pays with a voucher moves buckets), and the
SMS loop's own holdouts (~3–4 people) are far too small to separate it.

**Remaining path to RM5k:** measurement before more cutting. Hold budgets
through ~Aug 5 and read *organic* till with SMS steady; or freeze one outlet as
an ad-control while the others descend. Ceiling from cuts alone ≈RM6.4k/mo at
the RM20 floors.

**Follow-ups owed:** guard + scoreboard → organic till; remove the one-time
`hardCutDirective` block (inert, all three below RM55); fix the scoreboard
sales-side anchor (post-cutover window / exclude `storehub_sales`).

## Lessons

- Trailing forecasts normalize slow damage (boiling frog) — pair them with a
  fixed pre-intervention anchor.
- A guard that can blame the last change will blame it for gaps it could not
  have caused — bound attribution by effect-size plausibility.
- Negative keyword themes are fuzzy and slot-capped — treat slots as a
  scarce budget, spend them on measured cost.
- **Google's negative themes do NOT stem plurals.** The Jul 21 consolidation
  removed the working literals "restaurants" / "restaurants near me" in favour
  of the root "restaurant"; both plurals resumed spending the next day
  (RM24.46 in 2 days across Tamarind + Putrajaya ≈ RM370/mo) and the slots
  ended back at 25/25 anyway, so the swap bought nothing. Clean natural
  experiment in the data: spend → 0 while the literals were on (Jul 18–21),
  → back the day after they were removed.
- **Adding is a cheap bet; removing is an expensive one.** A speculative root
  that catches nothing costs one slot. Removing a demonstrably-working
  negative costs real money, silently. Never trade proven for assumed.
- **Apply-and-forget hides regressions.** The autopilot mutated Google and
  never checked the result, so a live leak read as "reporting lag" for two
  days. Anything applied to an external system needs a verification pass that
  can contradict the assumption behind it.
- **A flat aggregate can be two opposite moves.** Total till looked unchanged
  through the hard cut only because SMS-discounted orders rose as organic
  fell. Decompose before concluding a lever was free — and never let a guard
  read a metric another loop is actively inflating.
- Relative weakness (hot sibling) is not outlet weakness — gate experiments
  on the outlet's own absolute signal.
