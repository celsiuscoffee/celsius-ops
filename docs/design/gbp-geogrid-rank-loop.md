# GBP Geogrid Rank Loop — expand the #1 radius per outlet

_Office-hours diagnostic — 2026-06-24. Supersedes the "there is no GBP loop" conclusion in
[[ads-conversion-loop]] now that a real measurement (the geogrid) exists._

## Problem Statement
The request was "a GBP ranking loop based on SEO." Yesterday's docs rejected it twice —
[[ads-conversion-loop]] said GBP rank "isn't readable via API (proxy only) … a checklist to
execute, not a loop to engineer," and [[reviews-reply-recovery-loop]] kept only the
review-response lever. **Both were right given what they knew.** What unlocks the loop is a
measurement they didn't have: the **geogrid**.

The sharpened objective (owner, 2026-06-24): not "rank #1" at the doorstep — **expand the
radius over which each outlet holds #1 in the Google Maps 3-pack.** A café ranks #1 when you
search next to it and #8 three blocks away. The asset is the *size of the green zone*, and
that is measurable, trendable, and movable. That makes it a loop.

## What changed: rank IS measurable now (the geogrid)
You can't ask the GBP API "what's my rank." But you can **reconstruct** it: lay a grid of
geographic points around an outlet, and at each point ask Google's Places **Text/Nearby
Search** "coffee near here" with the search location biased to that point. Find our listing
in the returned order → that's our rank **at that cell**. Color the cell by position
(1 = dark green … 20+ = red). The screenshot is precisely this — a 9×9 grid where green =
we're top-3, red = invisible.

This converts the un-measurable into a weekly scalar field. The "#1 radius" the owner wants
is just a statistic over that field (defined below). The prior docs' core objection —
"rank isn't readable" — is resolved by proxy reconstruction, the same move they made for the
competitor-rank proxy but never built.

## Status Quo (what happens now)
- GBP API integration exists for **reviews + posts + replies** (`apps/backoffice/src/lib/reviews/gbp.ts`).
- **Zero rank measurement.** No Places API integration anywhere; no `GOOGLE_PLACES_API_KEY`.
- The "Nearby Competitor Ranking" proxy referenced as "already built" in the prior docs
  **does not exist** in code. It was aspirational.
- Rank levers (category, description, posts, photos, reviews) are tuned by feel, never
  A/B'd, never read back. Money and effort leave; nobody sees the result on the map.

## Target User (named person, consequence)
**Ammar (owner-operator).** The loop manufactures a decision he can't make today: *read the
geogrid per outlet → see exactly which direction the green zone is short → pull the lever
that widens it → confirm on next week's grid.* Today he can't even see the board. First a
visibility tool, then a decision cadence, then (maybe) automation — same escalation discipline
as the ads loop.

## The metric: define "#1 radius" before building anything
Run an **N×N grid** at spacing **d** centered on each outlet's `lat`/`lng` (both already on
the `Outlet` model). At each cell, store our integer rank for a keyword (1..20, or 21 = "not
in top 20"). Then per (outlet, keyword, week):

- **ATRP** — Average Total Rank Position across all cells. Lower is better. The headline
  trend line. (Industry-standard geogrid metric; "Local Falcon" calls it ARP/ATRP.)
- **SoLV** — Share of Local Voice = % of cells where we're in the top 3. The "how much of
  the map do we own" number.
- **#1 reach (the owner's actual target)** — the radius **r** of the largest concentric ring
  (centered on the outlet) within which the **median** cell rank is 1. This is the literal
  "radius of #1 ranking." Maximizing it is the loop's North Star. Report in km.

A grid is honest only if it's wide enough that the edge cells are NOT all #1 (else you've
under-sized it and can't see the frontier) and dense enough to locate the frontier. Start 9×9
at ~0.8–1.5 km spacing per outlet, tune after the first sweep.

## Premises (verify before building — repo ethos: don't build until you've looked)
1. **Each outlet is findable via Places Text Search** for the target keywords within ~5–10 km.
   If an outlet doesn't appear in the top 20 *anywhere* yet, the grid will be all-red and the
   loop's early job is "get on the board," not "widen the green." Verify per outlet first.
2. **Places API pricing is material and must be budgeted.** Cost ≈ (cells) × (keywords) ×
   (outlets) × (sweeps/month) API calls. A 9×9 × 5 keywords × 4 outlets = **1,620 calls per
   full sweep**; weekly ≈ 6,500/month. At Places Text Search ~USD $32/1k (Pro tier — **verify
   current pricing**, the old $200/mo Maps free credit was retired in 2025), that's ≈ **$200/mo**.
   Grid density, keyword count, and cadence are the cost dials — size them deliberately.
3. **ToS:** querying Places to read public ranking is fine. Do **not** stuff the GBP business
   *name* with keywords to game rank — it's a guidelines violation and a suspension risk. Name
   keywords are excluded from the lever list below for this reason.
4. Proximity is the dominant map-pack factor and is **fixed** (you can't move the café). The
   loop wins on the *other* factors that extend reach: relevance + prominence. Manage
   expectations: you widen the green, you don't make it infinite.

## The levers (what actually widens the green zone)
Ranked by leverage for *radius* expansion (not just doorstep rank):

1. **Reviews — volume, velocity, recency, and keyword content.** The strongest movable
   prominence signal, and the one lever you already have a live loop for
   ([[reviews-reply-recovery-loop]]). Reviews that *mention the keyword and the locale*
   ("best latte in Nilai") measurably widen relevance reach. **This loop's #1 input is the
   reviews loop's output** — they compound.
2. **Primary + secondary GBP categories.** Wrong/under-specified primary category caps reach
   hard. Audit all 4 outlets; add every truthful secondary category.
3. **Business description + Services/Products with keyword + locale.** Relevance for the long
   tail and neighboring towns.
4. **GBP Posts cadence (keyword-rich).** A minor, decaying signal — treat as a publisher, and
   **verify the `localPosts` write API still works** (it's been deprecated in places; see
   [[reviews-reply-recovery-loop]] open Q4). Reuse the round-poster system if so.
5. **Photos (geotagged, fresh, captioned), Q&A seeding, attributes.** Prominence + relevance
   trim.
6. **NAP / citation consistency + per-outlet local landing pages on the website.** Off-GBP
   SEO that lifts the whole grid, slowest to move.

The loop's job: each week the geogrid shows *which direction* the green zone is short → you
pick the cheapest lever that addresses that gap → re-measure. That targeting is the whole
value; without the grid you're pulling levers blind (status quo).

## Loop closure (the cycle)
```
weekly cron → geogrid sweep (Places API) per outlet × keyword
   → store rank field → compute ATRP / SoLV / #1-reach
   → backoffice "Local Rank" tab renders the grid + trend deltas
   → owner reads which edge is weak → pulls a lever (usually: more reviews,
     category fix, locale-keyworded posts)
   → next sweep confirms the green pushed outward (#1-reach ↑)
```
Closes on a measurable outcome (#1-reach in km, trending up). North-Star-aligned because
wider discovery → new strangers → feed the existing frequency loops (SMS win-back, round-gap).

## Approaches Considered

### Approach A — Measurement first: geogrid tracker + backoffice viz (the wedge, ~1 wk) — RECOMMENDED
- `GOOGLE_PLACES_API_KEY` + `lib/seo/geogrid.ts`: grid math around `Outlet.lat/lng`, Places
  Text Search per cell, find-our-rank, normalize.
- Prisma model `GeoRankSnapshot` (outlet, keyword, gridSpec, cells JSON, ATRP/SoLV/#1-reach,
  capturedAt). Migration in `packages/db`.
- Weekly cron `apps/backoffice/src/app/api/cron/geogrid-sweep/route.ts` (mirror
  `reviews-auto-reply`: `checkCronAuth`, iterate ACTIVE outlets, safety call-cap, idempotent).
  Register in `vercel.json` crons.
- Backoffice **"Local Rank"** tab: per-outlet grid heatmap (reuse the screenshot's visual),
  keyword switcher, and the three trend lines. Read-only.
- _Purpose: make the board visible BEFORE automating any lever. You can't widen what you can't see._

### Approach B — Close the loop: gap-targeting + Command Center alerts (weeks)
- Per-outlet "weakest edge" detector → suggests the lever (e.g. "south cells weak → seed
  reviews from the Nilai-south delivery zone; add 'Coffee shop' secondary category").
- Wire the reviews loop tighter: review-request nudges weighted toward under-covered geo.
- Command Center alert family: _"Outlet X #1-reach dropped >0.5 km WoW"_ / _"competitor
  overtook us in N cells."_
- Keyword-+-locale GBP post publisher (if `localPosts` write confirmed).

### Approach C — Autonomous local-SEO agent (months) — DEFER
Folds into the parked Marketing AI Agent: reads the grid, drafts category/description/post
changes + review-seeding plans, owner approves via Telegram. **Reject until B has run** —
same rule as the ads loop: don't automate a lever no human has pulled off the data yet.

## Recommended Approach
**A now → B once the owner has read 3–4 weekly grids and pulled levers by hand → C never
until B proves the gap-targeting works.** Build the scoreboard before the robot.

## Open Questions
1. **Keyword set per outlet?** Need the 5–10 real queries per locale (e.g. "coffee near me",
   "kopi Nilai", "cafe Putra Nilai", "specialty coffee Seremban"). Owner/locale knowledge.
2. **Grid size & spacing per outlet** — how wide is "the radius we care about"? 3 km dense vs
   10 km coarse changes cost ~3×. Decide ambition per outlet.
3. **Cadence** — weekly (trend-friendly, ~$200/mo) vs biweekly/monthly (cheaper, slower
   signal). Tie to #2's cost.
4. **Does each outlet currently appear in Places results at all** for its keywords? (Premise 1.)
5. **Is the GBP `localPosts` write API still live** for these 4 locations? (Carries over from
   [[reviews-reply-recovery-loop]].)

## Success Criteria (measurable)
- Within 2 sweeps: per-outlet geogrid visible in backoffice with ATRP / SoLV / **#1-reach (km)**.
- Within 60 days: **#1-reach trending up** for ≥2 outlets off a deliberate lever pull
  (category fix or targeted review seeding), confirmed on the grid — not vibes.
- The reviews loop's output (new reviews) shows up as widened relevance reach on the grid
  (the two loops visibly compound).
- ≥1 Command Center alert (Approach B) fires on a real reach drop that the owner acts on.

## The Assignment (one concrete next step)
**Before any code:** pick ONE outlet and ONE keyword. Open Google Maps, search that keyword
while spoofing your location to 3 points — the outlet's doorstep, ~1 km out, ~3 km out — and
write down our rank at each (Maps lets you drag the map / use a location override; or use any
free geogrid trial on that single query). Three numbers. If it's `1, 1, 4`, the loop's job is
"push the frontier from 1 km to 3 km" and the grid will pay for itself. If it's `1, 12, 21`,
the outlet isn't on the board past the doorstep and the first lever is categories + reviews,
not a wider grid. That single row of three numbers tells you which problem you actually have —
and proves the geogrid is worth wiring to the Places API. Don't build the grid until you've
hand-plotted three cells.
