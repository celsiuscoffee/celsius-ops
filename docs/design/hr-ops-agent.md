# HR Ops Agent — staff lifecycle & self-service over WhatsApp

**Status:** Design draft — owner + HOO review pending
**Date:** 2026-07-20
**Channel:** shared procurement WhatsApp number (persona resolved by sender)
**Substrate:** `agent_registry` / `agent_actions` (migrations 080/081), starts SHADOW

---

## 1. Role

A WhatsApp-facing agent that runs the staff lifecycle — hire, change, exit — and
answers staff questions about their own employment, while enforcing the
conventions and guardrails that today live only in the owner's head and in
one-off backoffice sessions.

Two personas on one number, resolved by the sender's phone:

- **Ops persona** (owner, HOO, outlet managers): create and modify employee
  records by chat. "New staff: … / IC … / bank …" → validated record card →
  confirm → written.
- **Staff persona** (everyone else on the staff roster): ask about *their own*
  schedule, hours, leave, pay; submit leave/MC/claims/swaps; complete their own
  profile.

Unknown numbers get a polite brush-off and the message is logged.

## 2. Why now (evidence from the 2026-07 onboarding sessions)

A single onboarding session (2026-07-16 → 07-20, five staff operations run
manually through Claude Code) surfaced every failure mode this agent must
handle — each one is now a hard requirement:

| Incident | Requirement |
| --- | --- |
| "Absah Natasha" was sent as a new hire but already existed (Nilai) | **Dedup by IC/phone/email/name before every create; switch to update-mode on hit** |
| "New **full timer** … Position: **PT Barista**" in one message | **Payroll-classification ambiguity → ask one crisp question, never guess** |
| "Branch: Cyberjaya" — no such outlet; owner clarified = Tamarind | **Alias map with learn-on-clarify; unknown branch → ask and remember** |
| "Farah" collided with a different Farah at Shah Alam | **Display-name disambiguation against existing roster** |
| Same 6-digit number arrived as "ID:", "pin:", nothing | **Field-label tolerance; PIN vs employee-ID resolved by asking once, then convention** |
| LOE PDF held salary/allowance/probation truth that the chat message lacked | **PDF ingestion; document terms override chat on conflict (with echo)** |
| Danish resigned FT 11/7, continued PT 12/7 | **FT↔PT conversion = close history segments + open new ones, never overwrite** |
| Manager hit "Unauthorized" editing his own team | **Authority comes from the reporting tree, not backoffice role hacks** |

## 3. Authority model

### Principles

1. **Subtree rule** — a sender can act only on people below them in the
   reporting tree (`hr_employee_profiles.manager_user_id`, walked transitively —
   same walk as `lib/hr/scope.ts`).
2. **Two-person rule for money** — salary and bank changes involve two distinct
   humans (requester + confirmer above them); owner alone may bypass.
3. **Reads wide, writes narrow, money narrowest.**

### Matrix

📝 = agent prepares the full validated record card and routes a one-tap
confirm/reject to the approver; nothing executes until they confirm.

| Action | Staff (own) | Manager (subtree) | HOO (all) | Owner |
| --- | --- | --- | --- | --- |
| View own schedule / hours / leave / claims | ✅ | ✅ | ✅ | ✅ |
| View own pay / payslip | ✅ *PIN challenge* | own only | own only | ✅ anyone |
| View team schedules / attendance / profile (non-pay) | ❌ | ✅ | ✅ | ✅ |
| View team salary / bank | ❌ | ❌ (parity with backoffice PII gate) | ✅ | ✅ |
| Apply leave / MC / swap / claim / availability | ✅ request | approve subtree | approve any | approve any |
| Fill own profile (emergency contact, address, personal email) | ✅ direct | — | — | — |
| Stations, schedule-grid flag, emergency-contact edits | — | ✅ direct | ✅ | ✅ |
| Position change within crew (barista ↔ kitchen) | — | ✅ direct | ✅ | ✅ |
| PIN reset | request → mgr confirms | ✅ subtree | ✅ | ✅ |
| Hire (PT standard rate) | — | 📝 → HOO | ✅ direct | ✅ |
| Hire (FT with salary) | — | 📝 → HOO | ✅ direct (LOE signatory) | ✅ |
| Outlet transfer / manager reassignment | — | 📝 → HOO | ✅ | ✅ |
| FT↔PT conversion / resignation processing | — | 📝 → HOO | ✅ | ✅ |
| Salary change (existing staff) | — | — | 📝 → **owner confirms** | ✅ |
| Bank detail change (existing staff) | request → **HOO confirms** | — | ✅ at onboarding; changes echo to owner | ✅ |
| Promote above crew / role changes | — | — | 📝 → owner | ✅ |

Deliberate asymmetries (owner-approved 2026-07-20):

- **New-hire salary: HOO alone** (he already signs the LOEs). **Salary changes:
  owner confirms** — raises are rarer and higher-stakes.
- **Managers never see pay/bank via the agent** — WhatsApp must not become the
  leak path around the backoffice PII gate.
- **A staff message alone never changes a bank account** — that is the classic
  payroll-diversion fraud. HOO confirms via a separate exchange; every change
  echoes to the owner.
- Leads (shift/barista leads) are treated as **staff** in v1.

## 4. Capabilities

### v1 — ship in shadow

1. **Onboarding & record changes** (ops persona): parse chat and/or LOE PDF →
   validate → dedup → record card → confirm → atomic write of
   `User` + `hr_employee_profiles` + `hr_salary_history` + `hr_job_history`,
   with staff-access preset, bcrypt PIN, DOB/gender derived from IC.
   Conventions per STATE.md 2026-07-16 entry (PT crew defaults, stations
   foh/boh, MONTHLY cadence, `epf_category='A'`).
2. **Staff self-service** (staff persona): own schedule / clocked hours /
   leave balance / claim status / payday+policy answers (from LOE terms);
   leave & MC submission (routes to manager), swap requests, claims via
   receipt photo, own-profile completion. Pay data behind a PIN challenge.
3. **Data-completeness chaser** (proactive, weekly): missing bank (payroll
   blocker), missing EPF, missing emergency contact, scheduled-but-profileless
   staff. Chases the person directly; escalates to HOO after 2 ignored nudges.
4. **Probation tracker** (proactive): reminds HOO 7 days before
   `probation_end_date`; collects verdict; drafts the confirmation letter via
   the existing `confirmation-letter` route.
5. **No-show alert** (proactive): scheduled shift with no clock-in 15 min in →
   ping outlet manager.
6. **Schedule push** (proactive): on roster publish, each staff member gets
   their own week's shifts.

### v1.5 — after arming

7. **Open-shift blast**: MC'd shift → manager approves offering it → agent
   messages eligible PT staff, first-accept wins, schedule updated.
8. **Payroll pre-flight**: before each weekly/monthly run, exception list to
   finance (missing bank, zero-hours-with-shifts, mid-month FT/PT splits).
   Prepares only — never marks paid (hard rule 6).

### Parked (roadmap)

Offboarding runbook (assets, access revocation, EPF/SOCSO cessation),
verification-letter generation, cert/typhoid expiry chaser, leave-coverage
check at approval time, memo broadcast with read-tracking,
birthdays/anniversaries (celebrations route), labour-budget early warning,
lead-tier approvals.

## 5. Voice & identity

Goal: **human in every way that matters — but never claims to be human.**

- Natural Malaysian WhatsApp register: short messages, contractions, BM/English
  code-switching mirroring the sender ("ok boleh, cuti 28–29 Jul saya hantar
  kat Adam untuk approve ya"). One question at a time. No bullet-wall replies
  to staff; record cards only for ops confirmations.
- Named persona (working name: **"Cel"** — bikin friendly, brand-adjacent;
  final name = owner's pick). WhatsApp business profile labels it a digital
  HR assistant.
- First contact with each staff member includes a one-line intro that it's the
  company's digital HR assistant. Asked directly ("ni robot ke?") it answers
  honestly and lightly. It does not volunteer disclaimers beyond that.
- **Why not fully indistinguishable:** (a) Meta's Business Messaging Policy
  requires automation disclosure — a report against the shared number risks
  banning the procurement loop with it; (b) staff disclose sensitive things
  (pay disputes, resignations, grievances) — discovered deception would poison
  every future interaction; (c) PDPA transparency expectations.
- Grievances/complaints: acknowledged empathetically, routed privately to
  owner + HOO, **excluded** from the general action ledger (sensitive-flag
  storage), and always handed to a human — the agent never "handles" a
  grievance itself.

## 6. Architecture sketch

- **Ingress:** existing Meta WhatsApp webhook (procurement). A sender-router
  runs before procurement intent handling: if sender ∈ staff roster (User.phone
  normalized) → HR agent; else existing supplier flow. HR-known numbers never
  fall through to the supplier agent and vice versa.
- **Identity:** phone → `User` row; role + subtree resolved per message.
  Session state (pending confirmations, half-filled onboarding drafts) in a
  `hr_agent_sessions` table with TTL.
- **Brain:** Claude with tool-use; system prompt carries the authority matrix,
  conventions, alias map, and voice guide. Long-lived facts (aliases, learned
  conventions) in a small `hr_agent_knowledge` table, editable from backoffice.
- **Hands:** server-side tools that mirror the exact writes of
  `/api/hr/employees/create` + the session-proven update patterns
  (history-segment close/open for conversions; `applyStaffPreset`; `hashPin`).
  All writes go through the tool layer — the model never emits raw SQL.
- **Ledger:** every parsed intent, proposal, confirmation, write, and refusal →
  `agent_actions` (registry key `hr_ops_agent`), except grievance content.
- **Kill switch:** registry mode (`off` / `shadow` / `armed-ops` /
  `armed-full`) checked per message via `getAgentMode` (fail-safe **off** —
  this is a NEW agent).

## 6b. Write guardrails (stage 2 — implemented 2026-07-28)

Owner opted to arm writes ahead of the 5-clean-shadow criterion; the
compensating control is that EVERY dangerous operation still requires an
explicit human confirmation, enforced in code (`lib/hr/agent/write-ops.ts`,
`pending.ts`, `hr_agent_pending_actions`):

1. **Typed operation allowlist** — create_staff, update_details,
   convert_employment, reactivate, resign, assignment, set_pin,
   salary_change (+ staff-persona: submit_leave_request, update_my_contact).
   The model fills parameters; it can never write SQL or touch other tables.
2. **Stage → CONFIRM flow** — ops writes are staged with a single-use 4-char
   code (unambiguous alphabet, 15-min expiry). Execution happens only in a
   deterministic pre-LLM webhook hook when the DESIGNATED approver's phone
   replies `CONFIRM <code>`; `REJECT <code>` kills it. Wrong-phone confirms
   are refused and ledgered.
3. **Authority routing** — plain managers' changes confirm with the HOO;
   salary changes and any bank-detail change confirm with the OWNER
   (two-person rule; owner self-confirms). Subtree rule on targets for
   managers. HOO identified by profile position (`head of …`).
4. **Dedup gates** — create_staff refuses on IC/phone/email match with an
   existing record; target resolution must land on exactly one person or the
   candidates are returned for disambiguation.
5. **Staff persona** — leave requests execute directly but always land as
   `pending` for manager approval (inherently double-gated); own contact
   updates execute directly; bank tools do not exist in the staff toolset.
6. **Rate limits** — ≤8 executed writes/hour per requester, ≤20 global.
7. **Kill switch re-checked at execution time** — flipping the registry off
   mid-flight stops already-staged actions. `shadow` = staging degrades to
   proposal-only logging; write tools are absent from the staff toolset
   outside `armed`.
8. **Ledger** — write_staged / write_executed / write_rejected /
   write_failed / confirm_refused all land in `agent_actions` with payloads.

## 7. Shadow mode & arming criteria

- **Shadow:** agent parses, validates, dedups, and produces the record card +
  proposed SQL in the ledger and to the owner — a human applies the change via
  backoffice/session as today. Staff-persona **reads** may go live during
  shadow (read-only, own-record, PIN-gated pay) since blast radius ≈ zero.
- **Arm ops writes** after **5 consecutive shadow onboardings/changes where the
  proposal matched the human-applied record with zero corrections** (matches
  the substrate rule: no arming without criteria).
- **Arm proactive senders** (chaser, no-show, schedule push) after one week of
  shadow digests to owner with no false positives.
- Any correction resets the counter for that capability class, not the others.

## 8. Compounding Contract

- **Reuses:** agent substrate (registry/ledger/kill switch), WhatsApp
  webhook + send infra, `applyStaffPreset`, `hashPin`, `lib/hr/scope.ts`
  subtree walk, existing HR API routes (confirmation-letter, claims extract),
  labour-gate revenue/schedule data.
- **Contributes back:** normalized-phone→User resolver (needed by any future
  staff-facing channel), `hr_agent_knowledge` alias/convention store (readable
  by backoffice UI autocomplete), the onboarding record-card format (reusable
  as the backoffice "review hire" screen), ledger-derived eval set — every
  shadow-vs-applied diff becomes a regression case, same pattern as
  `fin_agent_decisions`.
- **Outcome memory:** chaser nudges and their completions logged so nudge
  effectiveness is measurable (which chase phrasing gets bank details filled
  fastest).

## 9. Registry seed (ships with implementation PR, not this doc)

```sql
INSERT INTO agent_registry (key, name, domain, mode, arming_criteria)
VALUES (
  'hr_ops_agent',
  'HR Ops Agent (WhatsApp)',
  'hr',
  'shadow',
  '5 consecutive shadow ops proposals applied without correction; 1 week clean proactive digests'
);
```

## 10. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Payroll-diversion via spoofed/compromised staff phone | Bank changes need HOO confirm + owner echo; PIN challenge on pay reads |
| Shared-number confusion with supplier flow | Deterministic sender-router; HR numbers and supplier numbers are disjoint sets; unknown → neither agent, logged |
| Meta policy (automation disclosure) on shared number | §5 identity policy; business-profile labelling |
| Wrong-person writes (name collisions) | Dedup gate + record card always shows IC last-4 + outlet before confirm |
| Model drift into payroll actions | Tool layer has no payment/mark-paid capability at all; payroll runs untouched (hard rule 6) |
| PDPA (staff PII over WhatsApp) | Own-record-only reads; PIN gate on pay; grievances excluded from ledger; no group-chat operation |
| Webhook latency (3-LLM-call pattern flagged in procurement) | HR router ACKs Meta immediately, processes async — do not repeat the procurement webhook mistake |

## 11. Open questions

1. Final persona name ("Cel"?) — owner to pick.
2. Staff-persona reads live during shadow: confirmed OK? (Recommended yes.)
3. Chaser cadence (weekly Monday AM proposed) and nudge cap (2 then escalate).
4. Does the schedule-push replace or duplicate the staff-app notification?
5. BM formality register — "saya/awak" vs "kita" house style; sample scripts to
   review before build.

## 12. Rollout

1. Implementation PR: sender-router + identity + staff-persona reads (shadow
   window) + ledger wiring.
2. Ops-persona shadow: owner runs real onboardings via the agent's proposals.
3. Arm ops writes (criteria §7) → HOO switches from Claude-Code sessions to
   WhatsApp entirely.
4. Proactive senders shadow → arm.
5. v1.5 (open-shift blast, payroll pre-flight) design check-in.
