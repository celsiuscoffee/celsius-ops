# GBP Profile Optimizer (the real "page ranking" work)

_Office-hours diagnostic — 2026-06-24. Reframes the "page ranking loop"._

## Problem Statement
The user wants to "loop page ranking" by generating GBP updates optimized with the
best keywords. Diagnosis reframes this hard:

- **Posts don't move local rank.** Google has said GBP posts ("updates") are not a
  direct ranking factor — a weak freshness signal at best. `localPosts` is also on
  Google's deprecation path. A keyword-post loop optimizes a lever that barely moves.
- **The real relevance levers are the PROFILE FIELDS** — categories, business
  description, services/products, attributes, photos. And the user's own answer is that
  these are **thin/stale, set up once and never optimized**. That's the gap worth fixing.
- **Keyword impressions are measurable; rank and attribution are not.** The Business
  Profile Performance API exposes the real search terms customers used (monthly
  impressions) — a great INPUT. But you cannot attribute a rank/impression change to a
  specific edit. So this is **audit → optimize → periodic refresh**, NOT a tight
  measure→act→learn loop. Don't dress a publisher up as a loop (the trap from the
  original ads-conversion-loop doc).

## Demand Evidence
- Q1 Demand: **"Aspirational — rank higher."** No acute bleed. 3 of 4 outlets are
  4.5–4.8★ with 40–46 Google reviews; ~100 reviews/30 days — they're being found.
  (Nilai is the one real exception: 0 reviews / 0.0★, effectively invisible.)
- Q2 Status quo: **profiles thin/stale** — descriptions/categories/services/photos
  incomplete or outdated, set once and abandoned.
- Q3 Owner: **nobody** — no one owns GBP content; that's why it's stale.

Aspirational demand + orphaned ownership ⇒ build the smallest thing that proves value
with real data, and make it draft+apply so it needs ~no owner. Do NOT build a daily loop.

## Status Quo
Profiles sit untouched since setup. No keyword data is ever looked at. No posting, no
description/services upkeep. Nothing breaks loudly — which is exactly why it's neglected.

## Target User
**Ammar (owner)** — would approve/apply profile changes himself, but only if something
drafts the optimized description / categories / services for a few-minutes review (not
research from scratch). The tool has to do the work; the human just says yes.

## Narrowest Wedge
A **one-time keyword audit + profile gap report** for the 4 outlets: pull real GBP
keyword impressions + current profile state, AI cross-references to surface concrete
gaps ("Tamarind's top searches are X/Y/Z; description doesn't mention X; add category A;
services missing B/C"). Ammar applies the top fixes by hand in GBP. No write-back, no
loop. Either it reveals real opportunity (→ act, maybe automate) or shows you're fine
(→ stop, months saved).

## Premises (verify before building)
1. **Performance API** (`businessprofileperformance.googleapis.com`,
   `searchkeywords:impressions`) is enabled on the GBP project (My Project 23036) and the
   existing OAuth scope covers it. (Reviews use the GBP API; performance may need enabling.)
2. **Business Information API** (`mybusinessbusinessinformation.googleapis.com`) write
   access for `locations.patch` (description, categories) — services/photos have limited
   API support and may stay manual.
3. Profiles really are thin (Q2) — the audit will confirm per outlet.
4. Posts are NOT a meaningful rank lever (treated as fact; not building a post loop).

## Approaches Considered

### Approach A — One-time keyword audit + profile gap report (days) — RECOMMENDED
- Pull Performance API keyword impressions per outlet (last ~6 months).
- Pull current profile (description, categories, services) via Business Information API.
- AI cross-references → per-outlet report: high-impression terms missing from the
  profile, weak/wrong categories, thin description, missing services.
- Output to a simple backoffice page (or one-off doc). Ammar applies top fixes manually.
- Measure-first: validates the aspirational hunch with real data, zero write risk.

### Approach B — Draft + approve + API write-back + refresh (weeks)
- Backoffice "GBP Optimizer" panel per outlet: keyword data + current profile +
  AI-drafted optimized description/categories/services.
- Ammar approves → description + categories written via `locations.patch`;
  services/photos surfaced as a manual checklist.
- Monthly cron re-pulls keyword data, flags drift, says "time to refresh."
- Coarse outcome MONITORING only (impressions/actions trend per outlet) — explicitly NOT
  attributed to edits. No fake loop closure on rank.

### Approach C — Autonomous local-SEO agent (months) — REJECT
- Folds into the marketing agent: continuous profile edits + posts + review replies,
  Telegram-approved. Rejected: posts don't help, attribution impossible, no acute demand.

## Recommended Approach
**A first.** It's cheap, measure-first, and directly tests whether the aspirational goal
has real substance. Build **B only if** A shows consistent gaps AND the keyword data
shifts enough month-to-month to justify ongoing upkeep. Reject C.

**What flips it:** if A shows profiles are actually well-covered for the terms that
matter → stop. If A shows big gaps that recur as menu/seasons change → build B.

## Open Questions
1. Is the Performance API enabled on project 23036, or does it need turning on + scope?
2. How much can `locations.patch` actually write (categories yes; services? attributes?)
   vs. what stays a manual GBP-UI checklist.
3. Nilai (invisible) — is the fix even a keyword problem, or just "get the basics + first
   reviews live"? It may belong to the reviews loop, not this.

## Success Criteria (measurable)
- **A:** a per-outlet report exists naming the top search terms and the specific profile
  gaps; Ammar applies ≥3 concrete fixes per outlet. (Output is the deliverable, not rank.)
- **B (if built):** description+categories optimized + applied for all 4 outlets; monthly
  keyword-drift check runs; impressions/actions trend visible per outlet (monitored, not
  attributed).

## UPDATE 2026-06-24 — Geogrid changes the verdict (it IS a loop)
User clarified the goal with a **geogrid** screenshot: (1) increase ranking, (2) increase the
high-rank RADIUS. The geogrid is the measurement I claimed didn't exist — rank-by-location,
repeatable, comparable over time. So this becomes a genuine measure→act→learn loop.

Honest lever analysis (the grid measures, doesn't move):
- Each dot = rank for the keyword *searched from that spot*; colour driven by proximity
  (fixed), relevance (categories/description), prominence (REVIEWS: volume/velocity/recency).
- Goal #1 (rank↑) = relevance + prominence. Goal #2 (radius↑) = **~80% prominence = reviews**.
  Far from the store, only authority/reviews keep you ranking. So the engine that widens the
  green radius is the **reviews loop already built+live** — there's no separate radius loop,
  just a scoreboard for the reviews engine.

**BUILT (this branch):** in-house geogrid (chosen over renting Local Falcon). `GeoGridScan`
table (migration 056); `lib/geogrid/places.ts` (buildGrid + Places searchText rankAtPoint +
metrics: avgRank, pctTop3, greenRadiusM); `/api/geogrid/scan` (run + history); `/reviews/geogrid`
page (controls + colored N×N grid + the two goal-metrics + scan-history trend); sidebar "Local
Rank". Ships DARK until GOOGLE_PLACES_API_KEY set + Places API enabled on project 23036.
Places searchText w/ locationBias circle = PROXY for the Maps local pack (good for trend, not
exact). Cost ~RM350-400/mo at weekly cadence (81 calls/scan). Cron auto-scan = phase 2.

## The Assignment (one concrete next step)
**Before any code:** pull ONE outlet's real data and look. For Tamarind, get the GBP
"searches that showed your business" (top keywords + impressions) and its current
description + categories + services. Lay the top 5 search terms next to the profile and
ask: are they actually reflected? If yes for most → the gap is smaller than assumed,
rethink. If clearly no → that's your proof, and Approach A is worth an afternoon. Look at
real data for one outlet before building for four.
