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
- **GUARD reads ORGANIC till** (2026-07-27, `organic-revenue.ts`): promo/reward
  orders are excluded outright, because the SMS lifecycle loop manufactures till
  by minting vouchers and a guard reading TOTAL till cannot see ad damage while
  another loop inflates the same number. Actual AND forecast history come from
  the same series (swap the series function, never just the numerator, or the
  ratio compares organic against total and breaches instantly). Labour-gate
  keeps using total revenue — a voucher order still takes labour. Revert with
  `ADS_GUARD_REVENUE=total`.
- **PAYDAY ROBUSTNESS** (2026-07-27, owner: "salary is 25th usually in
  Malaysia… need to compare apple to apple"): Malaysian pay lands ~the 25th, so
  till runs on a monthly cycle a per-WEEKDAY forecaster cannot see. Adjacent
  weeks sit at different points in that cycle and are NOT comparable — the
  error made Tamarind read −12% w/w when payday-aligned it was −1.5%, and the
  fleet read −6.8% when organic was FLAT. `adjIndex` and `anchorIndex` already
  cancel it (one salary calendar fleet-wide); only `rawIndex` is exposed. So a
  `momIndex` (this window ÷ the same days-of-month a month earlier) is computed
  per outlet, and a breach driven ONLY by rawIndex while momIndex ≥0.97 is
  flagged `calendarArtifact` and does NOT roll back. Relative breaches are never
  suppressed.
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

**VERDICT (2026-07-27, payday-aligned): no visible harm; effect is below the
noise floor.** Compare the same days-of-month (payday-aligned) over 7 consecutive
days (weekday-complete), post-POS-cutover. **Use EVERY available aligned window,
not one** — a single window is fragile, and the first pass reported "organic
flat" from what turned out to be the most favourable of three:

| Aligned window (Jun→Jul) | Organic Δ | Total Δ |
| --- | --- | --- |
| 18–24 | −4.2% | +1.5% |
| 19–25 | −3.5% | +0.4% |
| 20–26 | 0.0% | +3.1% |
| **mean** | **≈ −2.6%** | **≈ +1.7%** |

**Ad spend is down 47% (RM300.20 → RM158.46/day) while TOTAL till is UP in all
three windows.** Organic softened ~2.6%, but discounted revenue rose by MORE in
ringgit than organic fell in every window — i.e. the organic dip is fully
explainable by cannibalisation (a walk-in who now pays with an SMS voucher
switches bucket without being a lost customer). So there is no evidence the cut
damaged demand, and equally no proof of a zero effect: the window-to-window
spread (~4 points) is as large as the effect being hunted.

Per-outlet organic on the 20–26 window: PJ **+5.6%**, SA **−4.2%**, Tam **−1.5%**
(the earlier "Tamarind −12%" was a payday artifact). The cuts side
(**+RM4,252/mo**) is real; whether any of it is offset cannot be resolved at this
precision — bounded roughly **−RM2k to +RM4.25k/mo** net.

*What the organic/discounted split is and isn't:* it SUBTRACTS a confound (the
SMS loop inflating the number the guard reads); it does NOT attribute revenue to
Google Ads. Organic = walk-ins, regulars, word-of-mouth, Grab **and** ads;
conversely an ad-driven customer who redeems an SMS voucher lands in
"discounted". Truly separating the two channels still needs a holdout or the
value-based conversion tag.

**Two earlier readings were wrong, both instructive:**

1. *"Till held flat" (Jul 21)* — right conclusion, wrong evidence: the total was
   flat only because organic fell while SMS-discounted rose.
2. *"Organic −6.8%, Tamarind −12%" (Jul 26)* — an artifact of comparing
   Jul 20–26 against Jul 13–19, two weeks at different points in the
   25th-payday cycle. **Never compare adjacent weeks.**

**Historical note — the confounds as they surfaced on Jul 23:**

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

**Cash: +RM4,252/mo from cuts**, net bounded ≈−RM2k to +RM4.25k/mo depending on
how much of the ~2.6% organic softening is real vs cannibalisation. Ceiling from
cuts alone ≈RM6.4k/mo at the RM20 floors.

**Remaining path to RM5k:** the guard now reads organic till and is
payday-robust, so the descent can resume when the observation window expires
(~Aug 3) — roughly RM45/day each closes the last ~RM750/mo. Watch Shah Alam
(−4.2% organic, the only outlet meaningfully down).

**Follow-ups owed:** remove the one-time `hardCutDirective` block (inert, all
three below RM55). *(Done 2026-07-27: guard + scoreboard on organic till; anchor
clamped past the StoreHub cutover; payday-aligned momIndex.)*

## Channel performance (payday-aligned Jun 20–26 → Jul 20–26)

Same days-of-month, so demand-cycle and weekday effects cancel. Source:
`ads_metric_daily`.

| | Jun 20–26 | Jul 20–26 | Δ |
| --- | --- | --- | --- |
| Spend | RM2,050 | RM1,198 | **−41.6%** |
| Impressions | 165,938 | 127,884 | −22.9% |
| Clicks | 3,744 | 2,972 | **−20.6%** |
| Avg CPC | RM0.55 | **RM0.40** | **−26.4%** |
| CTR | 2.26% | 2.32% | +0.06pp |
| Clicks per RM | 1.83 | **2.48** | **+36%** |

**The headline: spend fell 42% but clicks fell only 21%** — traffic held up far
better than budget because the money that left was buying junk. CPC dropped a
quarter and CTR rose, i.e. the *remaining* spend is better targeted, not merely
smaller. That is the exclusion work showing up in the auction, independent of
the till.

Per campaign (clicks per RM, Jun → Jul):

| Campaign | Spend Δ | Clicks Δ | CPC | Clicks/RM |
| --- | --- | --- | --- | --- |
| Putrajaya | −43.2% | −14.8% | 0.58 → **0.39** | 1.71 → **2.57** (+50%) |
| Tamarind | −43.4% | −17.3% | 0.93 → **0.64** | 1.07 → **1.56** (+46%) |
| Shah Alam | −37.8% | −25.8% | 0.36 → **0.30** | 2.77 → **3.31** (+19%) |

Tamarind — the junk-heaviest campaign (19.7% of spend on food terms) — had by
far the worst CPC at RM0.93 and improved most in CTR (1.85% → 2.06%), exactly
the signature of removing waste rather than reach. Shah Alam gave up the most
clicks per ringgit cut and is also the only outlet whose organic till is down in
every aligned window; it is the one to watch.

**Google's "conversions" fell 274 → 132 (−52%), cost/conv RM7.48 → RM9.07.
Ignore both.** These are Directions-clicks and calls (per-action sync stale
since 2026-04-19), not sales — they were never the objective and a 52% drop in
map-pin taps says nothing about cash. The till is the source of truth.

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
- **Respect the salary calendar.** Malaysian pay lands ~the 25th, so adjacent
  weeks sit at different points in a monthly demand cycle and are not
  comparable. Compare the same days-of-month; a 7n-day window is then balanced
  on weekday AND payday at once. Comparing week-to-week manufactured a −12%
  Tamarind "collapse" that was really −1.5%, and nearly reversed a correct
  conclusion.
- **One aligned window is still one sample.** The three available Jun→Jul
  windows spread −4.2% / −3.5% / 0.0%, so picking one silently picks a
  conclusion. Report every window and its spread; if the spread is as wide as
  the effect, say the effect is unresolvable rather than quoting the best number.
- **Removing a confound is not attribution.** Stripping voucher orders stops
  the SMS loop inflating the guard's signal; it does not make what remains
  "ad-driven revenue". Know which of the two a metric is doing.
- Relative weakness (hot sibling) is not outlet weakness — gate experiments
  on the outlet's own absolute signal.
