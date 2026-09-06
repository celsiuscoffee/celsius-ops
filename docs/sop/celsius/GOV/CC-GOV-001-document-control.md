---
id: CC-GOV-001
title: Document Control
company: celsius
domain: GOV
tier: procedure
owner: Managing Director
status: published
version: 1.0
effective_date: 2026-08-31
review_months: 12
ack_required: true
ack_stations: [lead]
language: en
linked_system_sop:
---

# CC-GOV-001 — Document Control

## 1. Purpose

Defines how Celsius Coffee's operating manual is written, approved, published,
distributed, and kept current, so that every SOP looks the same, has one owner,
and never silently rots. This document governs all other documents; when
another document conflicts with this one on process, this one wins.

## 2. Scope

All controlled documents of Celsius Coffee (`CC-` prefix) across all outlets
and departments. Gosame (`GS-`) adopts the same rules under its own manual.
Not covered: ad-hoc staff briefings, chat messages, and marketing content —
those are communications, not controlled documents (though a briefing may
*announce* one).

## 3. Definitions

| Term | Meaning |
|---|---|
| Controlled document | A document with an ID in the registry, subject to this procedure |
| Tier 1 — Policy | States why and what rules; approved intent |
| Tier 2 — SOP (procedure) | States who does what, when, across roles |
| Tier 3 — Work instruction | States exactly how, step-by-step, for one role/station; may be executed as a staff-app checklist |
| Tier 4 — Form / record | Captures evidence that a procedure ran |
| Registry | `docs/sop/REGISTRY.md` — the master index of all controlled documents |
| Owner | The ROLE accountable for a document's accuracy and review |
| Published | Approved and in force; the version staff are trained on |

## 4. Roles & responsibilities

| Role | Responsibility |
|---|---|
| Managing Director | Approves all Tier-1 policies and all GOV documents; final approver of any document until delegated |
| Document owner (per doc) | Keeps content true to actual practice; triggers revisions; completes reviews on schedule |
| Outlet manager / shift lead | Briefs published documents to affected staff; collects acknowledgments |
| All staff | Work to the published version; flag inaccuracies to the owner |

## 5. Procedure

### 5.1 Identification and numbering

1. Every controlled document has a unique ID: `{company}-{domain}-{number}`
   (e.g. `CC-FIN-003`). Numbers are sequential within company+domain and are
   **never reused**, even after archival.
2. Domains: GOV, OPS, PRD, HR, FIN, PROC, MKT, IT, CMP (see `docs/sop/README.md`).
3. The document's tier is recorded in its front-matter, not in its ID.
4. An ID is claimed by adding a registry row (status `PLANNED` is enough).

### 5.2 Format

5. Every document is written from `docs/sop/TEMPLATE.md` and keeps all eight
   sections (write "None" rather than deleting a section).
6. Owners are roles, never named individuals.
7. Documents reference other documents by ID and never restate their content.

### 5.3 Lifecycle

8. **Draft** — authored on a branch as `status: draft`, version `0.x`. Anyone
   may draft; the registry row moves to `DRAFT`.
9. **Review & approval** — the pull request is the review. The document's
   owner (and for Tier-1 or GOV documents, the Managing Director) approves the
   PR. Merge to `main` with `status: published` **is** the approval signature.
10. **Published** — version becomes `1.0` (or the next bump), `effective_date`
    is set, registry row moves to `PUBLISHED`, and the document is briefed per
    §5.5.
11. **Archived** — superseded or obsolete documents are set `status: archived`
    and stay in the tree; the registry row records what replaced them. Never
    delete a controlled document file.

### 5.4 Versioning

12. Minor bump (1.0 → 1.1): clarifications that do not change what anyone does.
    No re-acknowledgment required.
13. Major bump (1.1 → 2.0): any change to steps, responsibilities, or rules.
    Requires re-briefing and re-acknowledgment by the audience in
    `ack_stations`.
14. Every published change adds a row to the document's revision history table
    in the same PR.

### 5.5 Distribution and acknowledgment

15. On publish (or major bump) of a document with `ack_required: true`, the
    outlet manager briefs affected staff within 7 days.
16. Each affected staff member acknowledges: "I have read and understood
    {ID} v{X.Y}". Until the system acknowledgment feature ships (phase 1),
    acknowledgment is a signed sheet or Google Form kept by the outlet
    manager; these records are backfilled into the system later.
17. New hires acknowledge the published document set for their role during
    onboarding (see CC-HR-001 when written).

### 5.6 Review cycle

18. Every published document is reviewed by its owner at least every
    `review_months` months (default 12; food-safety and cash documents 6).
19. A review either re-confirms the document (revision history row "Reviewed,
    no change") or produces a revision. Either way the next review date resets.
20. A document overdue for review is flagged in the registry and, from
    phase 2, automatically by the system.

## 6. Records

| Record | Where | Retention |
|---|---|---|
| Registry | `docs/sop/REGISTRY.md` | Permanent |
| Revision history | §8 of each document + git history | Permanent |
| Acknowledgment sheets/forms | Outlet manager file / Google Form (interim); system from phase 1 | 2 years after superseded |

## 7. References

- `docs/sop/README.md` — manual structure and domain map
- `docs/sop/TEMPLATE.md` — the enforced template
- `docs/design/sop-module.md` — system implementation design
- Staff app SOP/checklist feature — execution layer for Tier-3 documents

## 8. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-08-31 | Drafted in agent session for MD review | First draft |
| 1.0 | 2026-08-31 | Managing Director | Approved and published |
