# Ads Spend Autopilot

_Built 2026-07-16/18 across PRs #947, #952, #954, #971, #972, #973 (all merged).
Live in production since the 2026-07-17 nightly run. Code:
`apps/backoffice/src/lib/ads/{autopilot,term-rules,pause-campaign}.ts`, wired
into `cron/ads-daily`. Kill switch: `agent_registry` key `ads_autopilot`
(Settings → System → AI Agents; fail-safe off if the row is missing;
shadow = decide + log, mutate nothing)._

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
- **Slot budget**: Smart campaigns cap negative keyword themes (~25).
  `MAX_NEGATIVES_PER_CAMPAIGN=25`, highest measured cost first (≥RM2/30d,
  ≤15/campaign/run); **seeded exclusions** (fleet-proven junk transferred to
  campaigns without their own term data, cost NULL) only fill leftover slots.
- Google negative THEMES match related searches (fuzzy) — e.g. "kopitiam
  near me" is collateral of the kedai-makan/restaurants themes. Monitor
  café-intent impressions.

### Budget state machine

- **WASTE-MATCHED CUT** (same run as its exclusions; paired bookkeeping, not
  an experiment): removes exactly the measured daily spend of exclusions not
  yet taken out of the budget (min RM0.50/day, ≤20%/cut). Exempt from
  observation windows / stagger / cut cap; still gated by the guard, the
  floor, and rollback coverage.
- **DESCEND**: once no unpaid waste remains, blind step-down 8% (12% when
  cost/conv >1.3× fleet-best), ≥14d observation, max 2 cuts/run, floor
  RM20/day (`ADS_AUTOPILOT_FLOOR_MYR`).
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

## Projection (2026-07-18, spend baseline ~RM8.6k/mo)

Locked-in near term: Jul 5 cuts RM504/mo + PJ waste cuts (RM169/mo applied,
tail follows) + Tamarind probe ~RM2.8k unspent during its 28d window.
Steady-state scenarios: ads work everywhere → ~RM1-1.3k/mo freed (waste layer
only) + probe-up revenue growth; Tamarind fails probe, PJ/SA partial →
~RM4.5-5k/mo; nothing moves the till → ~RM6.8k/mo (~RM82k/yr) with till flat
by construction. The Tamarind verdict (~Aug 15) collapses about half the
range.

## Lessons

- Trailing forecasts normalize slow damage (boiling frog) — pair them with a
  fixed pre-intervention anchor.
- A guard that can blame the last change will blame it for gaps it could not
  have caused — bound attribution by effect-size plausibility.
- Negative keyword themes are fuzzy and slot-capped — treat slots as a
  scarce budget, spend them on measured cost.
- Relative weakness (hot sibling) is not outlet weakness — gate experiments
  on the outlet's own absolute signal.
