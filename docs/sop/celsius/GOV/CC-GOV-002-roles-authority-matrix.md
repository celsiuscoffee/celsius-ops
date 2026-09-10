---
id: CC-GOV-002
title: Roles & Authority Matrix
company: celsius
domain: GOV
tier: policy
owner: Managing Director
status: published
version: 1.0
effective_date: 2026-09-01
review_months: 12
ack_required: true
ack_stations: [lead]
language: en
linked_system_sop:
---

# CC-GOV-002 — Roles & Authority Matrix

## 1. Purpose

Fixes who may decide what, and up to how much — so approvals are a rule, not
a negotiation, and so the systems can eventually enforce the same limits this
policy states. Where another document names an approver (e.g. refunds in
CC-FIN-001), this matrix is the master list they must agree with.

## 2. Scope

All Celsius Coffee decisions involving money, people, suppliers, systems, or
public communication. Not covered: Gosame (adopts its own copy when its
manual starts); day-to-day task assignment within a shift.

## 3. Definitions

| Term | Meaning |
|---|---|
| MD | Managing Director / Owner — final authority on everything |
| HOO | Head of Operations — the MD's operational deputy |
| AM | Area Manager — multi-outlet operations and recovery owner |
| OM | Outlet Manager — accountable for one outlet |
| Two-person rule | The requester and the approver must be different people; only the MD may act alone |
| System tier | The role stored on a user account: OWNER, ADMIN, MANAGER, or STAFF |

## 4. Roles & responsibilities

### 4.1 Business roles → system tiers

| Business role | System tier | Notes |
|---|---|---|
| Managing Director | OWNER | Bypasses all module gates |
| Back-office administrator | ADMIN | System administration; bypasses module gates — grant sparingly |
| HOO / Area Manager / Outlet Manager | MANAGER | Outlet-scoped; access via role presets |
| All other staff | STAFF | Outlet-scoped; access via role presets |

Rules that follow from the system's design:

1. A role tier is not a permission set: MANAGER and STAFF access comes from
   the standard presets (CC-HR-001 §5.1.3); extra grants need a justified
   request approved by the MD.
2. A manager may only grant others access they personally hold, and may only
   create STAFF accounts (the system enforces both).
3. "Shift lead" is a station, not a system role — a lead's extra authority
   is only what this matrix explicitly gives them.

## 5. Policy — the matrix

### 5.1 Money

| Decision | Requested by | Approved by | Limit |
|---|---|---|---|
| Purchase order — routine supplies | OM or procurement agent | OM self-approves | up to **RM 500** per order |
| Purchase order — above routine | OM | HOO/AM | **RM 501 – RM 2,000** |
| Purchase order — large / new commitment | HOO/AM | MD | above **RM 2,000**, and any order to a new supplier |
| Staff expense claim | Staff member | OM | up to **RM 200** per claim |
| Staff expense claim — larger | Staff member | MD | above **RM 200** |
| Petty cash top-up / replenishment | OM | MD | any amount |
| Customer refund | OM | MD | any amount (CC-FIN-001 §5.4) |
| Recovery voucher (free coffee) | System / OM | OM within the recovery flow | one per customer, system-enforced |
| Salary or bank-detail change | HOO | MD (two-person rule) | any amount |
| Payroll run finalisation | HOO | MD | every run |
| New recurring commitment (rent, subscription, service contract) | Anyone | MD | any amount |

*Every PO approval is recorded in the system (approver + timestamp). The RM
limits in this table are policy: the system does not yet block by amount —
managers are accountable for respecting them until enforcement ships.*

### 5.2 People (summary — detail in CC-HR-001 and the HR agent's rules)

| Decision | Requested by | Approved by |
|---|---|---|
| Hire (create staff record) | OM/manager | HOO (MD and HOO self-confirm) |
| Employment change, transfer, resignation processing | Manager | HOO |
| Probation confirmation | OM (review) | HOO |
| Disciplinary action (written warning and above) | OM/AM | MD |
| Review-penalty attribute/dismiss (RM10) | — | OM/AM per case |

### 5.3 Operations & systems

| Decision | Approved by |
|---|---|
| POS elevated action (void, price override) | Manager PIN, in person (OWNER/ADMIN/MANAGER) |
| Till access for unscheduled staff | Manager override PIN |
| Menu, pricing, and promotion changes | MD |
| Public replies to negative reviews; any public statement | AM or MD (CC-OPS-001 §5.2) |
| Supplier onboarding / change of terms | MD |
| Production database migrations | MD (proposed by agent/engineer, applied only after MD approval) |
| Native app releases (POS, customer, manager apps) | MD |
| SOP publication and revision | Per CC-GOV-001 (MD for Tier-1/GOV) |

### 5.4 Delegation and absence

4. Authority may be delegated only in writing (message from the MD naming
   the person, scope, and end date); the delegate cannot re-delegate.
5. If the named approver is unreachable and the decision cannot wait
   (safety, spoilage, store cannot open), the next tier up decides; if none
   is reachable, the OM acts, records what and why, and reports to the MD
   the same day. This exception never applies to salary, bank details,
   refunds, or anything in §5.1 above RM 2,000.

## 6. Records

| Record | Where | Retention |
|---|---|---|
| PO approvals | Inventory orders (approver + timestamp) | Permanent |
| HR confirmations | HR agent confirm log / HR records | Permanent |
| POS manager overrides | POS activity records | 2 years |
| Written delegations | MD's message + filed note | 2 years |
| Emergency-action reports (§5.4.5) | Message to MD, filed with the case | 2 years |

## 7. References

- CC-GOV-001 Document Control · CC-FIN-001 Payments & Refunds · CC-HR-001 New Hire Onboarding · CC-OPS-001 Incident & Complaint Handling
- `docs/access-control-guide.md` — system tiers, presets, grant clamping
- System note: the settings "Approval rules (spend thresholds)" table exists
  but is not yet enforced by any flow; when enforcement is built (SOP-module
  phase 2), it must be configured to match §5.1 of this policy.

## 8. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-08-31 | Drafted in agent session for MD review | First draft; RM limits proposed |
| 1.0 | 2026-09-01 | Managing Director | Approved and published — §5.1 RM limits confirmed as proposed |
