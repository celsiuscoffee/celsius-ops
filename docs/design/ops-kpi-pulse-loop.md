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
Two things, in the owner's words:
1. **"Make sure every ops is in check"** — *comprehensive* coverage. The target state watches
   all four standards (checklist, phone capture, reviews, audit/training), not one. Nothing
   slips silently anywhere.
2. **"Use this alert to monitor and remind the management / ops team"** — the day-to-day job
   is *monitoring + reminding*, not only catching failures after the fact. So every signal
   gets **two beats**: a **reminder** before/at the deadline (a low-friction nudge — "checklist
   due in 15 min", "phone-capture running low this shift") and an **alert** after the grace
   window (a logged, escalatable breach). Remind first; escalate only what the reminder didn't fix.

Underneath both sits one rule that gives it teeth: misses are **visible, owned, and
time-bound** — to the manager AND to the owner. North-Star metric: **breach rate trending DOWN
and time-to-resolve shrinking, per manager, week over week.** If alerts fire forever at a flat
rate, the loop is failing and we'll see it in the number — the point of a loop, not a feed.

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

### Alert catalog — proposed defaults (approve or adjust, don't block on these)
Two beats per signal: **Remind** (nudge, no escalation) → **Alert** (logged breach, escalatable).
All paged to the outlet's manager; **escalates to the owner** when the alert sits unacked past
its SLA. Numbers below are my suggested starting values, tuned in the shadow week.

| Signal | Remind (nudge) | Alert (breach) | Severity | Owner escalation SLA |
|---|---|---|---|---|
| **Phone capture** | Mid-shift, if rolling capture < 70% | Shift close < **60%** for the outlet | Med | 2 shifts below floor |
| **Checklist** | 15 min before `dueAt` | **30 min** past `dueAt`, still `PENDING` | High (opening/food-safety), else Med | 90 min past due |
| **Review** | — (reviews arrive unscheduled) | New `InternalFeedback` ≤ 2★ or risk-flagged GBP negative, **status open** | High if risk-flagged, else Med | 4 h unaddressed (same-day) |
| **Audit / training** | When the cadence window opens | Cadence window closes with no `COMPLETED` `AuditReport` | Low (lagging) — scorecard line + single reminder, **not** a real-time ping | On the weekly scorecard |

Defaults behind the catalog: **business hours** = outlet operating window (quiet hours queue
to open); **ack window** = 90 min high / same-day low; **dedupe** = one alert per
`dedupeKey`; **coalesce** = multiple new breaches in one sweep → one digest per manager, never
N pings; **morning open-items digest** + **end-of-shift summary** per manager.

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

### Draft WhatsApp templates (submit for approval first — they have lead time)
Five templates cover everything; each variable is a Cloud API body param. Quick-reply buttons
open the 24h window so the rest of the exchange is free-form.
- **`ops_reminder`** (nudge, manager): _"⏰ {{outlet}} — {{what}} due {{when}}. A quick heads-up."_
- **`ops_breach_digest`** (alert, manager): _"🔴 Ops Pulse — {{outlet}}\n{{count}} item(s) need
  you:\n{{lines}}"_ · buttons: **[Acknowledge] [Fixing now] [Snooze 1h]**
- **`ops_escalation`** (owner): _"⚠️ Escalation — {{outlet}}\n{{manager}} hasn't actioned:
  {{detail}}\nOpen {{duration}}."_ · button: **[View board]**
- **`ops_scorecard`** (weekly, manager + owner): _"📊 Scorecard — wk {{date}} · {{manager}}\nPhone
  {{cap}} (tgt {{capTgt}}) · Checklists {{chk}} on-time · Reviews {{revOpen}} open/{{revRec}}
  recovered · Audits {{audOverdue}} overdue · Alerts {{sent}} sent/{{esc}} escalated"_
- **`ops_resolved_ack`** (free-form, inside window): plain `sendWhatsAppText` confirmation — no
  template needed once the manager has replied.

### The scorecard
- `GET /api/cron/ops-scorecard` (weekly; daily owner digest optional) aggregates `OpsAlert` +
  raw rates per manager → `ops_scorecard` template to manager **and** owner.
- A backoffice **"Ops Pulse"** tab (reuse the `loyalty/loops` + Reviews-Ops dashboard pattern):
  live board, history, per-manager trend, SLA breaches.

### Channels — DM for accountability, group for visibility (and why the group goes on Telegram)
**Can WhatsApp send to a group?** Technically yes — Meta shipped a **Groups API** for the
Cloud API (2026) — but it is **not viable for this use case**, for four reasons:
- **Eligibility gate.** Group messaging reportedly requires an **Official Business Account**
  (green tick) **and a very high messaging tier (~100k business-initiated conversations / 24h).**
  An internal ops-alert workload will never reach that — so we likely can't turn it on at all.
- **Can't use your existing group.** The API can only message groups it **created
  programmatically**; an ops team's manually-made WhatsApp group can't be retrofitted.
- **Opt-in + 8-person cap.** Members join via invite link (no force-add), max **8 incl. admin**.
- **No buttons in groups.** Group messages are text/media/template only — which **kills the
  tap-to-ack quick-reply** the accountability loop depends on.

So the channel split is:
- **Alerts → WhatsApp 1:1 DM** to the accountable manager. Supported, keeps the ack buttons,
  and 1:1 is *better* for "keep her in check" anyway — a group diffuses ownership ("someone
  will get it"). Multiple recipients = **fan-out** (send the template to each DM), not a group.
- **Team visibility / reminders → a group.** A Telegram group (`lib/telegram.ts`, already
  wired) is the no-gate, no-cap, buttons-included option that works *today* — but the owner
  has opted to pursue a **WhatsApp** group via verification instead (see Channel decision below).
- Shared visibility doesn't actually *need* a group thread: the `OpsAlert` ledger + the Ops
  Pulse board + the scorecard are the shared source of truth; the group is just a convenience surface.
- (Unofficial WhatsApp-Web automation — Baileys / whatsapp-web.js — *can* post to any group but
  **violates Meta's ToS and risks a number ban**. Not for a business-critical ops system.)

### Channel decision (owner, 2026-06-24)
Owner wants the pulse delivered **in a WhatsApp group**, will **create a new** one (clears the
existing-group blocker), and — over a Telegram group or DM fan-out — chose to **pursue
verification and keep it on WhatsApp.** The number is a **standard WhatsApp Business account
(no verified badge) today**, so the Groups API is not available yet. Two honest catches:

1. **The badge clears one gate, not necessarily the Groups gate.** Verification removes the
   Official-Business-Account requirement, but the Groups API *also* reportedly needs a very
   high messaging tier (~100k business-initiated conversations / 24h) an internal ops workload
   will never reach — so verification may **still** not unlock groups. **Confirm Groups-API
   availability with the BSP/Meta before banking on it.** The **8-participant cap** applies
   regardless (ops + management must be ≤7 to fit one group).
2. **Verification path + timeline.** Two routes:
   - **Meta Verified (paid subscription)** — the realistic SMB route. Check **WhatsApp Business
     app → Settings / Business Tools → Meta Verified**; if the option isn't shown it's **not
     in your region yet** (rolled out India/Brazil/Indonesia/Colombia first — **confirm
     Malaysia**). ~3 business days when available.
   - **Free OBA (notability-based)** — needs press coverage / large social following; granted
     selectively; **2–8 weeks** and uncertain for an SMB.

**The build does NOT wait on verification.** The loop — `OpsAlert` ledger, detectors,
escalation, scorecard — is **channel-agnostic**; the sender is one swappable function.
- **Now:** build the engine, deliver via **WhatsApp 1:1 DM** to the manager (+owner). Works on
  today's standard number, keeps tap-to-ack buttons, and is the stronger accountability surface.
- **In parallel:** pursue Meta Verified; confirm Groups-API + tier eligibility with the BSP.
- **When/if unlocked:** add a **group sender** (new API group, invite link, acks via text reply
  — groups have no buttons). A one-file change, not a re-architecture.

The group is a *presentation surface*; the loop is the substance. A weeks-long, uncertain
verification shouldn't stall the ops value DMs can deliver this week.

## Premises (verify before building)
- There is effectively **one ops manager** today; routing = `User.role=MANAGER` whose
  `outletId`/`outletIds` covers the breach outlet, **owner as fallback/escalation.** There is
  **no region/area hierarchy** in the schema — fine for one manager, a gap when you add a
  second (see Decisions #3).
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
The destination is **all four signals in check** (objective #1). The sequence is only how we
get there without shipping a day-one firehose that gets muted:

- **Phase 1 (the spine + 2 clean real-time signals) — start here.** `OpsAlert` ledger + engine
  + escalation sweep + WhatsApp templates, wired to **phone capture + checklist** (the two
  cleanest real-time signals, with reminder *and* alert beats). Run **one week in shadow** (log
  what it would page, read it, confirm each breach is real), then arm escalation.
- **Phase 2 (full coverage).** Add **reviews** (subscribe to the existing recovery pipeline,
  don't rebuild) + **audit/training** (scorecard line + single reminder, not a real-time ping)
  + the **weekly scorecard** + the backoffice **Ops Pulse** tab. This is "every ops in check."
- **Phase 3 (later).** Fold drafting/prioritising/threshold-tuning into the existing
  `ai-agent/celsius-overview`.

The discipline that makes this a loop — the ledger, the ack state machine, the escalation rule,
the scorecard — is built **once** in Phase 1 and is identical for all four signals, so Phase 2
is mostly adding detectors. Comprehensive *coverage*, sequenced *rollout*.

## Decisions — proposed defaults (these are my suggestions; adjust any)
Owner said "suggest first," so these are decided defaults, not questions. Tune in the shadow week.
1. **Escalation SLA** → **90 min** business hours (high-severity); same-day for low. ✅ proposed.
2. **Thresholds** → phone-capture breach < **60%**/outlet/shift (target 80%); checklist grace
   **30 min** past `dueAt`; audit = cadence window closes unmet. ✅ proposed (per Alert Catalog).
3. **Routing** → single ops manager today = default assignee for all outlets, owner = escalation.
   ✅ works now. ⚠️ **the one real gap:** the schema has **no outlet→manager map** (no
   `Outlet.managerId`, no region hierarchy). The moment a *second* manager exists, we need to
   add that mapping. Flagging now; not a Phase-1 blocker.
4. **Quiet hours** → per-outlet operating window; out-of-hours breaches queue and send at open. ✅.
5. **Scorecard** → **weekly** to manager + owner, plus a short **daily owner digest**. ✅.
6. **Snooze** → manager may snooze 1h, **but the snooze still counts on the scorecard** — a
   silenced alert is still a miss. ✅ (this is what stops snooze becoming a mute button).

## Success Criteria (measurable)
- Loop ships with the **phone-capture detector** live: breaches logged to `OpsAlert`, paged to
  the manager, **auto-escalated to the owner** when unacked past SLA.
- Every alert has a recorded **ack/resolve state and timestamp** — no breach dead-ends.
- First **weekly scorecard** delivered to manager + owner with capture %, breach count,
  time-to-resolve, and % escalated.
- Over 4–6 weeks: **capture rate up, breach rate down, time-to-resolve down** for that manager.
  The falling number — not the message stream — is the deliverable.

## The Assignment (one concrete next step)
Defaults are proposed above — **approve them as-is, or adjust any number** — and I build
**Phase 1**: the `OpsAlert` ledger + the phone-capture and checklist detectors (reminder +
alert beats) + the escalation sweep + the WhatsApp templates. It runs **one week in shadow** —
logging the breaches it *would* have paged so you read them and confirm each is real — and only
then do we arm escalation. Two lead-time items to kick off in parallel: **submit the five
WhatsApp templates for approval**, and **confirm the manager's + owner's WhatsApp numbers**
(`User.phone`). Watch before you arm it.

## Build log
- **2026-06-24 — channel = WhatsApp 1:1 DM.** Owner chose 1:1 DMs over a group (WhatsApp
  Groups API gated behind a verified badge + a messaging tier an internal workload won't reach;
  group deferred behind verification). DMs work on today's standard number and keep tap-to-ack.
- **2026-06-24 — Phase 1a (shadow) shipped.** Read-only detect-and-log, **no sends, no schema
  change**:
  - `apps/backoffice/src/lib/ops-pulse/` — `config` (mode + thresholds), `detectors`
    (`detectPhoneCapture` via `pos_orders`, `detectChecklist` via Prisma `Checklist`),
    `router` (outlet→MANAGER, owner fallback), `index` (`runOpsPulse`, masks phones, logs
    would-be pages).
  - `apps/backoffice/src/app/api/cron/ops-pulse/route.ts` — `checkCronAuth`-gated cron.
  - `vercel.json` — `/api/cron/ops-pulse` **hourly** while shadowing.
  - `OPS_PULSE_MODE` env (`off|shadow|armed`, unset ⇒ shadow). Deploying starts the shadow week.
- **2026-06-24 — Phase 1b (armed path) wired.** Owner confirmed 60% phone floor, 90-min
  escalation, and **+reviews**. Built (dormant until `OPS_PULSE_MODE=armed`):
  - `OpsAlert` model (`schema.prisma`) + SQL migration
    (`packages/db/prisma/migrations/20260624_ops_alert/`).
  - `detectReviews` — internal QR feedback ≤2★ (open) + negative Google review drafts ≤3★
    (pending), bounded to a 72h recency window.
  - `ledger` (dedupe + OPEN→ESCALATED→RESOLVED lifecycle; phone-capture excluded from
    escalation), `sender` (template-or-text WhatsApp digest), `inbound` (reply "DONE" →
    resolve), runner armed branch (persist → page new per-manager digest → escalate past SLA),
    ack hooked into `api/whatsapp/webhook`.
- **2026-06-24 — audit signal added (food director / barista lead).** `detectAudit` flags a
  tracked auditor `roleType` with no `COMPLETED` `AuditReport` at an active outlet inside a
  cadence window. No audit cadence exists in the schema, so it's defined in config. Owner
  confirmed: **weekly cadence (7 days)**; roles resolved against live data —
  **`barista_head`** (barista lead: Barista Station Audit / Barista Skills) and **`chef_head`**
  (food director: Kitchen Quality Audit / Kitchen Crew Skills). Coverage counts a COMPLETED
  OUTLET *or* STAFF report of the role. LOW severity, deduped per outlet/role/window, **never
  escalated** (lagging, not a now-fix-it incident). A role only fires if it has an active
  `AuditTemplate`. (`AUDIT.cadenceDays` / `OPS_PULSE_AUDIT_ROLES` to tune.)
- **2026-06-24 — audit split: outlet coverage vs. staff training.** Owner clarified the two
  audit types behave differently:
  - **Outlet audits = 1×/week per outlet** → `detectOutletAudit` (OUTLET templates: Barista
    Station Audit, Kitchen Quality Audit), weekly coverage.
  - **Skill audits = # staff trained** → `detectSkillTraining` (STAFF templates: Barista
    Skills, Kitchen Crew Skills). Cross-DB join: HR position (`hr_employee_profiles` —
    Barista×29, Kitchen Crew×10) → staff→outlet (`User`) → completed skill `AuditReport`s.
    Reports **trained/eligible per outlet** (currently **0/39 trained**). LOW severity, never
    escalated — a coaching/scorecard number, not an incident.
- **2026-06-24 — routing redesigned to discipline-based + procurement signals.** Owner set
  recipients by *type*, not outlet→manager:
  - **operations** (phone, checklist, reviews, procurement) → **Ariff + Adam Kelvin** (resolved,
    have phones).
  - **barista** (barista_head audit + skill) → **Syafiq**; **kitchen** (chef_head) → **Chef Bo**.
    ⚠️ Neither resolves to an active `User` (the Barista-Lead HR profile points to a missing
    user; the Kitchen Leads are Haziq/Shairuleen/Ameir, no "Bo"). Routes are config-driven
    (`OPS_PULSE_*_RECIPIENTS`, matched on `User.name`); **unresolved names fall back to the
    owner** until confirmed. Detectors stamp `routeKey`; the router resolves names → recipients
    (first = primary, owns ack/escalation; rest co-receive the digest).
  - **Procurement signals added** → operations: `detectStockCount` (no SUBMITTED/REVIEWED count
    in 7d, LOW), `detectReceivings` (DISPUTED=MED/PARTIAL=LOW in 7d, **escalates**),
    `detectMenuSnoozed` (86'd item count via `outlet_product_availability`, MED).
- **2026-06-24 — DB correction + recipients confirmed.** The production Prisma DB is the
  loyalty Supabase project (`kqdcdhpnyuwrxqhbuyfl`); earlier manual spot-checks mistakenly hit a
  separate `celsius-inventory` project. The **code was always correct** — every detector uses
  `prisma` / `hrSupabaseAdmin` / `getSupabaseAdmin`, which all point at the real DB. Corrected
  facts: all four recipients are active **MANAGERs** with phones, each on 5 outlets via
  `outletIds` — Ariff, Adam Kelvin, **Syafiq Kaberi** (`+601137506488`), **Chef Bo**
  (`+60126057787`); names resolve, so routing + ack attribute correctly (kitchen route set to
  "Chef Bo", the account name). Audits/training ARE happening (Barista Station 30, Barista Skills
  14, Kitchen+Food audits 24, Kitchen Crew Skills 6) — the earlier "0 everywhere" was the stale
  project. ⚠️ Apply the `OpsAlert` migration to the **loyalty project**, not celsius-inventory.
- **2026-06-24 — audit + skill now escalate; skill = 1/week/staff.** Owner wants proof the work
  is done, so `AUDIT` (outlet audits + staff skill training) joins CHECKLIST/REVIEW/RECEIVING in
  the escalation set — unacked past SLA → owner, **tagged with the responsible lead's name** so
  the owner sees *who* isn't getting it done. Weekly dedupe means each overdue audit escalates at
  most once per week. Skill coverage is now window-based (audited within 7d, not ever) — skill =
  1/week/staff; outlet audit = 1/week (unchanged). PHONE_CAPTURE / STOCK_COUNT / MENU_SNOOZED
  stay non-escalating.
- **2026-06-24 — daily pulse (ship first) + full review text.** Added `runDailyPulse` + cron
  `/api/cron/ops-pulse-daily` (~9am MYT): once a day, each lead gets ONE roundup of everything
  outstanding in their lane — no ledger, no escalation, just a predictable daily cadence to build
  the discipline. Controlled by `OPS_PULSE_DAILY_MODE`, **independent** of `OPS_PULSE_MODE`, so the
  daily digest can go live while real-time stays in shadow — and it needs **no OpsAlert migration**.
  Review alerts now carry the **full review text** (up to 1000 chars; was a 60-char clip).
  - **Recommended rollout: daily first.** Set `OPS_PULSE_DAILY_MODE=armed` + approve one
    `ops_daily_pulse` template → the team gets a daily habit-forming digest with zero migration.
    Once that's a discipline, arm the real-time + escalation path (`OPS_PULSE_MODE=armed`,
    needs the OpsAlert migration + the breach/escalation templates).
- **Go-live checklist for the REAL-TIME path (before `OPS_PULSE_MODE=armed`).** (1) apply the `OpsAlert` migration to the
  DB; (2) get `ops_breach_digest` + `ops_escalation` templates APPROVED and set
  `OPS_PULSE_TPL_*`; (3) confirm manager + owner `User.phone`; (4) bump the cron from hourly to
  15-min in `vercel.json`; (5) set `OPS_PULSE_MODE=armed`. Until then it stays in shadow.
