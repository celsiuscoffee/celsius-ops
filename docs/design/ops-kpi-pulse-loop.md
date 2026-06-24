# Ops KPI Pulse — Accountability Loop

_Office-hours diagnostic — 2026-06-24. Owner: Ammar._

## Problem Statement
Four ops standards slip silently today, each in a different system, each found out
days late (or never):
1. An outlet **skips a checklist** (`Checklist.status` stuck `PENDING` past `dueAt`).
2. A **POS sale captures no customer phone** (`pos_orders.customer_phone` null) — the
   single most expensive miss, see below.
3. A **bad review** lands and dead-ends (`InternalFeedback.rating` low / `ReviewReplyDraft`).
4. A **required audit/training isn't done** (no `COMPLETED` `AuditReport` for the period).

The owner wants WhatsApp (now live — `apps/backoffice/src/lib/whatsapp.ts`) to surface
these in real time and, in his words, **"keep the ops manager in check."** That last phrase
is the whole design. The goal is not *notification*; it's *accountability*.

## Objective (owner directive 2026-06-24)
Make the ops manager's misses **visible, owned, and time-bound** — to the manager AND to
the owner — so a slipped standard cannot quietly stay slipped. North-Star metric for this
loop: **breach rate trending DOWN and time-to-resolve shrinking, per manager, week over
week.** If alerts fire forever at a flat rate, the loop is failing and we'll see it in the
number — that is the point of building it as a loop, not a feed.

## Status Quo (what happens now)
- Checklists, audits live in backoffice/staff DB; nobody is paged when one lapses — the daily
  `reset-checklists` cron just wipes the slate at 16:00 (`apps/staff/.../cron/reset-checklists`).
- Phone capture is a field on `pos_orders` (native Poster POS, Supabase) that nobody watches.
- Negative reviews already have a recovery pipeline ([[project_reviews_reply_recovery_loop]])
  whose risk tier escalates to **Telegram (Adam/Ammar)** — so an internal-alert precedent and
  channel already exist.
- The owner finds out about all four by asking, or by a customer/area-manager complaining.
  Discovery is manual, lagging, and unowned.

## Target User (named)
- **The ops manager** — the accountable human the loop keeps in check. Single primary
  assignee today (`User.role = MANAGER`, joined to outlets via `User.outletId` / `outletIds`).
- **Ammar (owner)** — the escalation target and scorecard reader. The person who today
  finds out too late. Keeps him up at night: standards slipping at outlets he can't be in.

## Narrowest Wedge
**One signal — POS phone-capture rate — wired end to end through the full loop machine**
(detect → route to manager → require ack → auto-escalate to owner → weekly scorecard),
then clone the engine to the other three. Phone capture is the wedge because it is the only
signal that is simultaneously: **leading** (predicts revenue, not records it), **100% the
manager's job** (it's pure cashier behaviour she controls), **continuous** (a clean daily %,
perfect for a scorecard), and **currently unclosed** (nothing watches it). And it is the
**join key for every other loop the company is building** — [[project_sms_loop_engineering]]
states it plainly: *"Phone is the join key."* Every uncaptured phone is a customer made
permanently invisible to win-back, frequency, birthday, and every attribution number. Fix
the capture rate and you widen the mouth of the entire marketing funnel.

## What's a loop and what isn't (read this before building)
Per the house distinction ([[project_reviews_reply_recovery_loop]]):
- **A "pulse" that pings on every miss is a notifier, not a loop.** It has no closure. Within
  two weeks the manager filters it like spam and nothing changes. This is the default failure
  mode and the thing to NOT build.
- **This becomes a loop** only when it closes on a measured outcome: every breach has an
  **owner**, an **acknowledgement**, an **escalation if ignored**, and a **resolution state** —
  and the breach *rate* is tracked so we know the intervention is working. The deliverable is a
  falling number, not a stream of messages.

## The Lever (the owner's actual question)
The highest-leverage mechanism here is **not alert volume — it's the accountability state
machine plus the weekly scorecard.** Three structural choices give the loop teeth; the first
two are the lever:

1. **Auto-escalate to the owner on silence.** Breach → manager is paged → if not
   acked/resolved within an SLA (propose 90 min, business hours) → it **escalates to Ammar**.
   Silence stops being a safe option. This single rule is what converts a nag into a check.
2. **A weekly manager scorecard, not just incident pings.** Real-time alerts handle the
   *incident*; the scorecard handles the *pattern* — "this week: checklist 87% (target 95%),
   phone-capture 62% (target 80%), 2 unaddressed 1★, 1 overdue audit; 3 alerts escalated."
   The scorecard is the artefact you review *with* the manager. Pings without a scorecard =
   nagging; a scorecard without pings = too slow. **If only one thing ships, ship the
   scorecard** — it turns noise into a managed number and a recurring conversation.
3. **Route to the accountable person, never the location.** A miss pages the manager who owns
   that outlet, by name, with the outlet named — personal accountability, not a broadcast a
   cashier ignores.

## Design

### The spine: an alert ledger (new `OpsAlert` model)
Everything hangs off one table. Without it you have a notifier; with it you have a loop.
```
OpsAlert {
  id, signal (CHECKLIST|PHONE_CAPTURE|REVIEW|AUDIT), outletId,
  assigneeUserId, severity,
  dedupeKey @unique,            // e.g. "phone_capture:outlet123:2026-06-24" — one alert, not 50
  detail (Json),                // value, threshold, offending ids
  status (OPEN|ACKED|ESCALATED|RESOLVED|EXPIRED),
  channel, providerMessageId,   // WhatsApp message id, for inbound ack matching
  sentAt, ackedAt, escalatedAt, resolvedAt, createdAt
}
```
It gives you, in one place: **dedupe** (no firehose), the **ack/escalation state machine**
(teeth), the **scorecard data** (time-to-ack, time-to-resolve, recurrence, % escalated), and
an **audit trail**.

### Per-signal detectors (one pure function each)
A detector returns `{signal, outletId, severity, dedupeKey, detail}[]`. Grounded in real
fields (`packages/db/prisma/schema.prisma`):
- **Phone capture** — query Supabase `pos_orders` for the window; breach if capture %
  (`customer_phone not null`) over the last shift falls below threshold for an outlet.
  *Continuous rate → also drives the scorecard line directly.*
- **Checklist** — `Checklist where status=PENDING and dueAt < now` (or `timeSlot`+`SopSchedule.dueMinutes`
  elapsed). Breach per overdue instance, deduped per outlet+slot.
- **Audit/training** — no `AuditReport` with `status=COMPLETED` for a (template, outlet) whose
  cadence window has closed. *Low-frequency → scorecard line, NOT a real-time ping (see below).*
- **Review** — do **not** rebuild. **Subscribe** to the existing negative-review ESCALATE
  event ([[project_reviews_reply_recovery_loop]]); a 1★/risk-flagged review with no decision
  after SLA becomes an `OpsAlert`. Reuse, don't duplicate.

### The engine (mirror the live loop-engine)
Reuse the proven shape of `apps/backoffice/src/lib/loyalty/loop-engine.ts` +
`api/cron/loops-send`:
- `GET /api/cron/ops-pulse` (`checkCronAuth`-gated, in `apps/backoffice/vercel.json`),
  every 15 min — the cadence `loops-send` already uses; "real-time" here means *within the
  SLA window*, not per-event.
- Per run: **run detectors → upsert OpsAlert by `dedupeKey` (dedupe) → route → send → run the
  escalation sweep** (any `OPEN` past SLA → escalate to owner, set `escalatedAt`).
- **Quiet hours + caps**: suppress outside operating hours; one **digest per manager** per run
  (per-incident lines inside it), not N messages. Realtime ≠ spam.

### WhatsApp specifics (the constraints that bite)
From `lib/whatsapp.ts`:
- **Proactive alert ⇒ approved template.** A pulse is business-initiated, outside the 24h
  window, so each alert/digest/escalation needs an **approved template** in WhatsApp Manager
  (`ops_breach_digest`, `ops_escalation`, `ops_scorecard`). Approval has lead time — start it
  first. Variables: manager name, metric, outlet, value, threshold, deep link.
- **The 24h-window trick buys interactivity for free.** The moment the manager taps a
  **quick-reply button** ("Acknowledge" / "Fixing now" / "Snooze 1h") or texts back, a 24h
  free-form window opens → `sendWhatsAppText` can run a full ack/resolve conversation for 24h
  at no template cost. So ship templates *with* quick-reply buttons.
- **Inbound ack** extends the existing webhook (`api/whatsapp/webhook` — it already has the
  TODO routing hook): match `providerMessageId` / button payload → flip `OpsAlert` to
  `ACKED`/`RESOLVED`, stop the escalation timer.

### The scorecard
- `GET /api/cron/ops-scorecard` (weekly; daily owner digest optional) aggregates `OpsAlert` +
  raw rates per manager → `ops_scorecard` template to manager **and** owner.
- A backoffice **"Ops Pulse"** tab (reuse the `loyalty/loops` + Reviews-Ops dashboard pattern):
  live board, history, per-manager trend, SLA breaches.

### Channel note (Telegram vs WhatsApp)
The internal escalation channel today is **Telegram**, which has native inline buttons +
callback queries (`lib/telegram.ts`) — richer for ops control and zero template approval.
WhatsApp is where the managers actually live and what the owner asked for. Recommend:
**WhatsApp for the manager-facing pulse** (meet them where they are), keep **Telegram for the
owner-facing escalation + approve flows** (richer, instant). One ledger, two senders.

## Premises (verify before building)
- There is effectively **one ops manager** today; routing = `User.role=MANAGER` whose
  `outletId`/`outletIds` covers the breach outlet, **owner as fallback/escalation.** There is
  **no region/area hierarchy** in the schema — fine for one manager, a gap when you add a
  second (see Open Questions).
- `User.phone` is populated and WhatsApp-reachable for the manager and owner.
- `pos_orders.customer_phone` is the live capture field post-POS-native cutover (it is, per
  `lib/finance/ingestors/pos-native-eod.ts`); legacy `SalesTransaction` has **no** phone and
  is irrelevant to this signal.
- WhatsApp templates can be approved for these alert types (start the approvals first).

## Approaches Considered

### Approach A — Phone-capture accountability loop, full machine, one signal — RECOMMENDED (~days)
Build `OpsAlert` + the engine + escalation + scorecard, but wire **only the phone-capture
detector**. Proves the entire loop (detect → route → ack → escalate → measure) on the
highest-leverage, cleanest signal. Deliverable: capture-rate breaches paged to the manager,
escalated to the owner on silence, and a first weekly scorecard with a real number to move.

### Approach B — All four signals on the same engine (~1–2 wks)
Add the checklist, audit, and review detectors onto the A engine. Checklist and review reuse
the ledger directly; audit enters as a **scorecard line only** (low-frequency, lagging — a
real-time ping is noise). Suppression, quiet hours, per-manager digest, the full Ops Pulse tab.

### Approach C — Fold into the AI ops agent (months) — defer
The existing `api/ai-agent/celsius-overview` (runs 4×/day) proposes the digest, prioritises by
severity, drafts the manager message and the owner escalation, learns which alerts actually get
resolved, and tunes thresholds. Same ledger underneath.

## Recommended Approach
**A now → B once the loop mechanics are proven on one signal → C later.** The discipline that
makes this work — the ledger, the ack state machine, the escalation rule, the scorecard — is
built *once* in A and is identical for all four signals. Adding signals (B) is then cheap.
Resist shipping all four as a notifier on day one: that's the exact firehose that gets muted.

## Open Questions
1. **SLA before escalation to owner** — propose 90 min in business hours. Acceptable?
2. **Thresholds** — phone-capture floor (propose 80%/outlet/shift)? Checklist grace past
   `dueAt`? Audit cadence per template?
3. **One manager or several?** If several are coming, we need an outlet→manager mapping
   (`Outlet.managerId` or a join table) — the schema has none today.
4. **Quiet hours** — operating window per outlet, or one global window?
5. **Scorecard cadence** — weekly to manager + owner; also a short daily owner digest?
6. **Snooze policy** — can the manager snooze, and does a snooze still surface on the scorecard?
   (It should — a silenced alert is still a miss.)

## Success Criteria (measurable)
- Loop ships with the **phone-capture detector** live: breaches logged to `OpsAlert`, paged to
  the manager, **auto-escalated to the owner** when unacked past SLA.
- Every alert has a recorded **ack/resolve state and timestamp** — no breach dead-ends.
- First **weekly scorecard** delivered to manager + owner with capture %, breach count,
  time-to-resolve, and % escalated.
- Over 4–6 weeks: **capture rate up, breach rate down, time-to-resolve down** for that manager.
  The falling number — not the message stream — is the deliverable.

## The Assignment (one concrete next step)
Decide the two things only the owner can: (1) the **escalation SLA** (how long the manager has
before it lands on your phone — propose 90 min) and (2) the **phone-capture floor** that counts
as a breach (propose 80% per outlet per shift). Then we wire `OpsAlert` + the phone-capture
detector + the escalation sweep + the first scorecard — the full loop on one signal. Before
turning escalation on, run the detector in **shadow mode for one week**: log the breaches it
*would* have paged, read them, confirm the manager would agree each is real. Watch before you
arm it.
