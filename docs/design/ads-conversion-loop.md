# Ads Conversion Loop (and why there is no GBP "loop")

_Office-hours diagnostic — 2026-06-23_

## Problem Statement
We are spending on Google Ads on autopilot (Smart Campaigns / Performance Max) with
**no wire back to orders**. Money leaves the building; nobody reads the result; nobody
acts. The request was "build a loop for GBP ranking + Google Ads." Diagnosis splits that
in two and rejects most of it:

- **Google Ads is the real patient.** There is a live bleed (blind spend).
- **There is no GBP "loop" worth building.** GBP rank isn't readable via API (proxy only),
  the levers are slow and un-A/B-able, and the Reviews module already does the
  highest-leverage thing (review volume / recency / response). GBP is a checklist to
  execute, not a loop to engineer.

## Demand Evidence
- Q1: "Already spending blind" — money out, no attribution to orders. (Real bleed, not a hunch.)
- Q2: "Google auto-pilots it" — Performance Max / Smart Campaigns bids unattended; no one
  adjusts keywords, budget, or geo.
- Q3: "Nobody acts on cost-per-order today — that's the gap." No decision-owner exists.

## Status Quo (what happens now)
Google's ML optimizes bids in real time — but toward whatever conversion signal it's fed.
If that signal is "clicked Order Now" / "visited site," Google is buying **cheap clicks**,
not RM40 pickup orders, and it has no idea a Nilai order is worth more than a bounce.
The loop already exists (Google's); it's pointed at the wrong target and no human reads it.

## Target User (named person, consequence)
**Ammar (owner-operator).** The loop's first job is to manufacture a weekly decision he
doesn't make today: read cost-per-order by outlet → move the budget envelope (pause losers,
scale winners). Not an ops-manager tool yet — the decision muscle has to exist before it
can be delegated or automated.

## The reframe (core insight)
> **Don't build a bidder. Feed Google's bidder real POS order value.**

You will not out-optimize Performance Max by hand. You close the loop by making order value
(by outlet) the conversion signal. Then Google's autopilot optimizes toward actual revenue,
and a human just reads ROAS and moves the budget. This also sidesteps the Explorer-token
wall: **conversion tracking via Google's tag + the Ads UI needs zero API access.**

## North Star alignment
Acquisition (new strangers) is a departure from the frequency/AOV loops (SMS, round-gap).
It stays aligned **only because the conversion is value-based**: feeding order *value* makes
Google buy high-AOV-order clickers, not RM12 single-coffee orders. A "count of orders"
signal would depress AOV. New customers then feed the existing frequency loops downstream
(new order → SMS win-back → repeat). Value-based conversion is the load-bearing choice.

## Premises (explicit assumptions — verify before building)
1. **The ad click lands on the web order flow** (order.celsiuscoffee.com with a `gclid`),
   not only on the Maps listing / call / directions. **If false, the whole design changes**
   (see Open Questions). This is the #1 thing to verify.
2. Order-confirmation page can fire a client-side tag with order value + hashed phone/email.
3. Monthly spend is material enough (> ~RM1k) to justify even Approach A.
4. Google Ads dev token is Explorer/test tier → **no production API access** (read or write)
   until Basic access is approved. Affects B, not A.

## Approaches Considered

### Approach A — Fix the signal, no API, no build (days, mostly config) — RECOMMENDED
- Ads UI: create **"Pickup Order"** conversion, `value = order total`, count = every.
- Order-confirmation page: fire Google conversion tag + **enhanced conversions**
  (hashed phone/email) with ringgit value + outlet (custom param or per-outlet action).
- Performance Max re-optimizes toward revenue per outlet immediately.
- Free add: set **GOOGLE_PLACES_API_KEY** to wake the already-built Nearby Competitor
  Ranking → passive weekly proxy-rank trend (the only "GBP" piece worth flipping on).
- Cadence: 5-min weekly look at the ROAS column. No backoffice build.
- _Purpose: prove Ads can convert profitably BEFORE investing in an in-house loop._

### Approach B — In-house scorecard + offline conversion import (weeks)
- Apply for **Basic access** (the real gate).
- Capture `gclid` on every web order → store on `pos_orders`.
- Daily edge function (mirror `storehub-sync`): upload offline conversions keyed on gclid
  with **net** ringgit value — catches tag-missed orders, gives outlet precision.
- Backoffice **"Acquisition"** panel: spend / cost-per-order / ROAS by outlet & campaign,
  pulled from Ads API. Command Center alert family: _"Outlet X Ads ROAS < 1."_
- Still human-in-the-loop: panel makes reallocation a 5-minute weekly call.

### Approach C — Autonomous Ads + GBP agent (months) — REJECT FOR NOW
- Folds into the parked Marketing AI Agent: proposes budget reallocation, drafts GBP
  ranking posts, auto-responds to reviews; Ammar approves via Telegram.
- Rejected: nobody acts on the data today. Don't automate an action no human has taken.
  Build the muscle (B) first.

## Recommended Approach
**A now → B after ~3–4 weeks of A → C never until B has run.**
Flip conditions: if monthly spend is trivial, stop at A and check quarterly. If ads don't
drive the web order flow (Premise 1 false), A's tagging captures nothing — fall back to a
coarse spend-vs-outlet-order-lift holdout (SMS-loop style), and B becomes the real wedge.

## Open Questions
1. **Where does the ad click actually land?** Web order flow (gclid-trackable) vs Maps /
   call / directions (not tie-able to a `pos_order`). Decides whether A works at all.
2. What's the actual monthly spend, and per outlet? Determines if any of this is worth it.
3. Are we even spending on the *right* outlets/hours, or is Performance Max free-roaming?
4. Does the order-confirmation page already load gtag / any Google tag today?

## Success Criteria (measurable)
- **A:** within 30 days, blended Ads ROAS (order value ÷ spend) is visible per outlet and
  trending up vs the pre-tag baseline; ≥1 outlet's campaign paused or scaled on the data.
- **B:** cost-per-order by outlet visible in backoffice; one budget reallocation executed
  off the panel; Command Center fires a real low-ROAS alert that you act on.

## The Assignment (one concrete next step)
**Before any code or config:** open Google Ads → for one campaign, click into the ad and
follow exactly where the click lands. Write down: does it hit order.celsiuscoffee.com with
a `?gclid=...` in the URL, or does it go to the Maps listing / a call / directions? That
single answer decides whether Approach A is "an afternoon of tagging" or "the design has to
change." Don't build until you've looked.
