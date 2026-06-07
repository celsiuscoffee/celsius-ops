# Cashier Performance Dashboard

_Office-hours diagnostic — pre-build. Owner: Ammar._

## Problem Statement
Measure how effective each cashier is at the two behaviours the owner already nags
about but can't see: (1) collecting customer phone numbers, and (2) upselling.
Surfaced to owner + outlet supervisors (backoffice) AND to each staff member on
their own HR page.

## Demand Evidence
- **Q1 → "Owner already nags staff."** Existing behaviour (verbal + gut feel),
  inconsistent and blind. Real, but nagging is free — the dashboard only earns its
  keep if a *weekly ritual or consequence* eats the number (staff seeing their own
  number on the HR page is that consequence).
- **Hard baseline (old loyalty app, 30d to 2026-06-07, all outlets):**
  - Collection rate **12%** (1,000 / 8,206 orders) — target **70%**.
  - 587 new members, 226 returning (2+ visits), **RM 12,723 returning sales/30d**.
  - → 226 returning members already drive ~RM12.7k/mo. At 70% collection we'd
    capture ~5,744/mo instead of ~1,000 (≈ +4,700 numbers/mo). The funnel's top is
    the constraint, and it's wide open. **Demand validated — the money is real.**
- **CRITICAL READ: 12% this far below 70% is a SYSTEM problem, not per-cashier
  variance.** At 12%, even the "good" cashiers are almost certainly nowhere near
  70% — the ask largely isn't happening at all. A dashboard *measures*; it does not
  by itself move 12%→70%. The lever that moves collection is the **POS flow forcing
  the ask on every order** — which the new POS already has (the "ask-first" member
  prompt at order start, task #203). **Dashboard = scoreboard; the ask-first prompt
  = the game.** Build them as a pair; the prompt does the heavy lifting, the
  dashboard verifies it's working + catches cashiers who dismiss it.
- **Root cause CONFIRMED (owner): staff don't ASK.** Not a value-prop / customer-
  decline problem — so structural prompting + accountability is the right fix:
  - **Customer side:** customer-display prompts "claim your rewards" PRE *and* POST
    checkout — the customer can self-identify even if the cashier forgets.
  - **Staff side:** ask-first reminder on every order (#203).
  - **Dashboard:** the accountability layer that proves the prompt is used and
    flags whoever dismisses it. Right tool, because the bottleneck is behaviour,
    not customer willingness.
- **Attribution caveat:** the 12% is from the OLD app — aggregate only, no
  per-cashier breakdown. Per-cashier spread (and the dashboard) only exist once
  on POS (employee_id). So 12% is the pre-POS baseline to beat; the dashboard is a
  POS-launch deliverable measuring the *new* flow, not the old one.

## Status Quo (what users do now)
- **Q2 → "Loyalty DB starves."** The dominant cost is uncollected phone numbers:
  every un-asked number = a customer who can't be brought back; the whole
  loyalty/remarketing engine depends on collection rate, and it's invisible.
- Current workaround: owner walks in, eyeballs, nags everyone equally, rewards
  no one, never knows if it improved.
- **Upsell (AOV) is the secondary pain**, and it's the gameable metric.

## Target User (named, consequence)
- **Primary actor:** Ammar (owner) — weekly review across 4 outlets; coaches/
  nudges laggards. Also outlet supervisors per outlet.
- **The measured:** each cashier, who sees their **own** collection % (and later
  upsell rate) on their **staff HR page**. This is what makes it behaviour-
  changing — and what makes the upsell metric a gaming target.

## Premises (explicit assumptions — verify before/while building)
1. `pos_orders.employee_id` is reliably stamped on **cashier-rung** orders.
   _Verified in code (checkout.ts:221 + create_pos_sale RPC). Confirm it's
   non-null in practice._
2. **Only cashier-rung orders count** in the denominator. Grab / pickup /
   QR-table self-orders have **no cashier to ask** — they must be EXCLUDED, or a
   cashier's collection rate is polluted by orders they couldn't act on.
   Scope to `source` in (pos/register) dine-in + takeaway.
3. `pos_orders` carries a phone/member reference (customer_phone / member_id) —
   that's the collection numerator.
4. `pos_pair_events` logs Pair-with-a-Bite suggestions; needs to record at least
   {order_id, employee_id, item_id, event: shown|added|converted} for an honest
   upsell metric. _Schema to verify in Phase B._
5. Staff identity = the PIN login session (StaffSession). employee_id maps to an
   hr_staff / staff record for the display name.

## Metric definitions

### 1. Phone collection rate (PRIMARY — objective, low gaming)
- **Rate** = cashier-rung paid orders with a valid phone/member ÷ all cashier-rung
  paid orders, per cashier, per outlet, per period.
- **Split new vs repeat:** new = phone's first-ever order (member created at/around
  this order); repeat = existing member. The high-value action is acquiring NEW
  numbers (grows the DB); the split shows whether a cashier acquires or just
  re-scans regulars.
- **Instrument the prompt, not just the outcome.** Since the POS controls the
  ask-first prompt, log its funnel per order: **shown → cashier engaged (asked) /
  skipped → collected**. This separates the cashier's *controllable* action (did
  they ask) from the *outcome* (customer said yes/no) — fairer to staff, and it
  precisely catches the confirmed failure mode (dismissing the prompt without
  asking). Headline stays collection %; "prompt-skipped-without-collect rate" is
  the sharp coaching signal. Cheap — the prompt (#203) exists; just log the tap.
- **Anti-gaming (entering fake / own numbers):**
  - Validate MY mobile format (reject junk).
  - **Flag any single phone attached to > N orders by one cashier in the period**
    (real regulars exist, but the cashier's own number on 30 tickets is the tell).
  - The new-vs-repeat split self-exposes it (fake number = same id = "repeat"
    spike on one member).
- **Safe to show staff + even bonus-gate** (with the dedupe guard) — a real number
  in the loyalty DB is a verifiable asset.

### 2. Upsell success (SECONDARY — fragile, must be gamed-proof)
The owner's stated fear: staff spam "Pair with a Bite" to pump the number. So:
- **DO NOT measure raw upsell COUNT** — that directly rewards button-spam.
- **Measure CONVERSION RATE** = suggestions that converted to a *paid* add ÷
  suggestions shown. Spamming the button on orders that don't convert *tanks* the
  rate, killing the spam incentive.
- **Causal attribution** — a conversion counts ONLY if:
  - the suggested item was added **through the suggestion UI** (a pos_pair_events
    `added` event tied to that suggestion), AND
  - it **survives to the paid order** (not removed before checkout), AND
  - it wasn't **already in the cart** before the suggestion (no claiming credit
    for a bite the customer already ordered).
- **Cross-checks (flag, don't reward):**
  - **Added-then-voided rate:** bite added via suggestion then removed pre-payment
    = fake tap → flag the cashier, don't count it.
  - **Suggestion-shown spam:** abnormally high "shown per order" → flag (rate
    already penalises it).
  - **Attach-lift vs baseline:** does this cashier's suggestion actually lift
    bite-attach above their *own* no-suggestion baseline? The honest north-star.
- **Keep upsell COACHING-ONLY, not bonus-gated (at least initially).** Any
  single-button behavioural metric that gates money gets gamed; rate + flags make
  it useful for coaching without the spam incentive.
- **Scope:** only the Pair-with-a-Bite button is cleanly attributable to cashier
  effort. Size upgrades / modifier attach / "your usual" adds are NOT reliably
  attributable (customer may have ordered them anyway) — do not count them as
  cashier upsells; they invite noise + gaming.

## Approaches Considered

### Approach A — Collection-rate wedge (days) ★ RECOMMENDED FIRST
- One backoffice report: per-cashier collection rate, new/repeat split, per outlet,
  weekly; the same single number on each staff member's HR page.
- Uses existing `employee_id`; scoped to cashier-rung orders; dedupe/format guard.
- No upsell yet. Ships the #1-pain metric (loyalty DB), which is ungameable, on
  both surfaces. ~2–4 days.

### Approach B — A + honest upsell + leaderboard (weeks)
- Verify/extend `pos_pair_events` (shown→added-via-suggestion→paid + employee_id).
- Upsell **conversion rate** + anti-gaming flags (void rate, spam rate, attach-lift).
- Staff HR page shows upsell rate (coaching-only); backoffice leaderboard + outlier
  flags. ~1–2 weeks.

### Approach C — Full performance suite (months) — NOT NOW
- Incentive/bonus engine tied to HR payroll; multi-vector upsell (size, modifiers,
  combos); automated coaching nudges; anomaly detection.
- Months, and a large gaming surface. Defer until A+B prove the ritual sticks.

## Recommended Approach
**A now, B as a fast-follow once A proves the owner + staff actually look at it
weekly.** Rationale: `employee_id` already exists → A is cheap and ships the metric
that maps to the dominant pain (collection), which is safe to put in front of staff.
Upsell needs its anti-gaming guards designed before a gameable number goes on the
staff HR page.

**Rollout sequencing (important — the flow is a big change for staff):**
Do NOT turn on the scoreboard on day 1 of a brand-new POS. Staff are already
learning a new till + a new loyalty flow; scoring them simultaneously breeds
resentment and reflexive prompt-dismissal/gaming.
1. **Launch:** POS + dual prompts only. Let the new flow become habitual; collection
   should climb from the prompts alone. **Log the prompt funnel from day 1** (data
   accrues silently) and watch the new baseline.
2. **Once the flow is habitual (~2–4 weeks):** turn on the scoreboard (Approach A)
   for the last-mile accountability — coaching the cashiers still skipping after the
   flow is second nature.
This also cleanly separates the *flow's* effect (the structural lift) from the
*scoreboard's* effect (the last mile) so you know which did what.

Also (fairness): with two capture paths, the dashboard should distinguish
**collected-via-cashier-ask** vs **collected-via-customer-self-serve** — both grow
the DB, but only the first reflects cashier effort, so the staff-facing metric
shouldn't credit/penalise self-serve captures the same way.

**Evidence that would flip the rec:**
- If the 30-day collection spread is flat (everyone similar) → don't build A; the
  problem isn't real, rethink.
- If `pos_pair_events` already logs shown→converted cleanly with employee_id → B's
  upsell is cheap enough to ship alongside A.
- If `employee_id` is null on many cashier-rung orders → A needs an attribution
  cleanup first.

## Open Questions
- Period + cadence: weekly per-cashier, or per-shift? (Weekly to start.)
- Does collection bonus-gate pay, or coaching-only at launch?
- Supervisors: real per-outlet role, or just Ammar + staff self-view for now?
- pos_pair_events exact schema (event types, employee_id, order linkage).

## Success Criteria (measurable)
- **Baseline 12% → target 70%** collection on cashier-rung orders (old-app
  baseline; re-baseline once on POS with the ask-first flow live).
- The POS launch itself (ask-first prompt) should jump collection materially
  *before* any dashboard coaching — if it doesn't, the bottleneck is customer
  decline, not staff asking.
- Within 1 month of staff seeing their own number, **bottom-quartile cashiers'
  collection rises** (proof the dashboard changed behaviour, not just reported it).
- Zero obvious fake-number gaming (dedupe guard catches it).

## The Assignment (one concrete next step)
Root cause is confirmed (staff don't ask) and the structural fix (dual prompts) is
already in the POS — so this is now an *implementation* item gated on POS launch,
not a discovery question. **First build step at launch: instrument the ask-first
prompt to log {shown, skipped, collected}, then ship Approach A** (collection
scoreboard, baseline 12% → 70%, backoffice + staff HR page). **Re-baseline
collection in week 1 post-launch** — the dual prompts alone should lift it well
above 12% before any coaching; the dashboard then holds the last mile.
