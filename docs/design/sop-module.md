# SOP module — company operating manual (Celsius Coffee + Gosame)

*Designed 2026-08-31 with the owner. Phase 0 shipped on branch
`claude/celsius-coffee-sop-module-0md66t`.*

## What this is (and is not)

A **company-level SOP system**: the operating manual for how each business runs —
governance, ops, product, HR, finance, procurement, marketing, IT, compliance.
It is NOT the outlet checklist feature that already exists in the staff app
(`Sop`/`SopStep`/`Checklist`/`SopSchedule`); that system stays as-is and becomes
the *execution layer* of this one (Tier 3/4 below).

Two companies are served: **Celsius Coffee (`CC-`)** and **Gosame (`GS-`)**.
Gosame is a separate business entity (own staff, own infra — a `gosame-ops`
Supabase project already exists, created 2026-07-10). Each company gets its own
manual tree; the framework, template, and numbering scheme are shared.

## Document framework

Four tiers — every document sits in exactly one, and links downward:

| Tier | Type | Answers |
|---|---|---|
| 1 | Policy | why / what rules |
| 2 | SOP (procedure) | who does what, when, across roles |
| 3 | Work instruction | exactly how, step-by-step, one role/station — the staff-app checklists live here |
| 4 | Form / record | evidence it happened |

Domains (chapters) for Celsius: `GOV OPS PRD HR FIN PROC MKT IT CMP`.
Gosame's domain map is TBD (depends on its business; decide when its manual starts).
`GRP-` prefix is reserved for group-shared documents if the two companies turn
out to share functions — none defined yet.

Document ID = `{company}-{domain}-{number}`, e.g. `CC-FIN-003`. Numbers are
sequential per company+domain regardless of tier; the tier is metadata.
Full rules live in `docs/sop/celsius/GOV/CC-GOV-001-document-control.md` —
the meta-SOP, written first on purpose.

## Architecture: git-as-CMS

Git is the authoring and approval system; the database only stores what the
apps need at runtime.

```
docs/sop/**.md ──PR merged to main──▶ scripts/sop-sync (CI) ──▶ DB (published versions)
 (author/approve = PR review)                                      │
                                              backoffice ◀─────────┴────────▶ staff app
                                          (registry, compliance)      (read + acknowledge)
```

- **Authoring**: markdown in `docs/sop/`, YAML front-matter carries all
  metadata (`id`, `tier`, `owner`, `version`, `status`, `review_months`,
  `ack_required`, …). PR merge = approval; git history = revision history.
- **Publishing** (phase 1): a CI step on merge to `main` parses front-matter,
  validates (unique IDs, version bumped when content changed, registry
  consistent — fails the PR otherwise, same pattern as `migration-guard`),
  and upserts published docs into the DB.
- **Consumption** (phase 1): staff app renders published versions and records
  sign-offs; backoffice reports coverage.
- No CMS/editor build. If managers later need to edit without git, add a
  backoffice editor that commits via the GitHub API — architecture unchanged.

## Data model (phase 1, via the db-migration skill)

~4 new tables. Key points: acknowledgments bind to a **version**, not the
document (publishing v1.3 automatically re-opens compliance); `Company` is a
cheap tenancy seam now (everything defaults to Celsius) so Gosame onboarding
later is data + RLS work, not a schema rewrite; `linkedSopId` ties Tier-3 docs
to the existing staff-app `Sop` rows so checklists can cite their governing
document and flag re-briefs when it changes.

```prisma
model Company            { id, code @unique /* CC, GS */, name }
model SopDocument        { id, companyId, code @unique /* CC-FIN-003 */,
                           tier, domain, title, ownerRole,
                           status /* PUBLISHED|ARCHIVED — drafts live in git */,
                           sourcePath, reviewMonths, nextReviewAt,
                           ackRequired, ackStations SopStation[],
                           linkedSopId? @unique → Sop }
model SopDocumentVersion { id, documentId, version /* "1.2" */, contentMd,
                           changelog, gitSha, publishedAt
                           @@unique([documentId, version]) }
model SopAcknowledgment  { id, versionId, userId, method /* APP|PAPER */,
                           acknowledgedAt
                           @@unique([versionId, userId]) }
```

## Surfaces (no new apps)

- **Staff app** `(ops)/sops` → add a "Company Handbook" section: docs by
  domain, markdown reader, one button "I have read and understood vX.Y".
  New-version nudges ride the existing ops-nudges loop.
  APIs: `GET /api/sop-docs`, `GET /api/sop-docs/[code]`,
  `POST /api/sop-docs/[code]/ack`.
- **Backoffice** `/ops/sops` → registry + compliance view: all docs with
  status/version/owner/next-review; compliance matrix (staff × required docs,
  % acknowledged, who's outstanding); docs overdue for review. Coverage %
  feeds the ops KPI pulse.

## Phases

| Phase | Ships | Status |
|---|---|---|
| 0 | `docs/sop/` skeleton, template, registry (seeded from the 10 live staff-app SOPs), `CC-GOV-001` draft | **this branch** |
| 0.5 | First 3–5 real documents, written by pain: cash handling (FIN), new-hire onboarding (HR), incident/complaint handling (OPS) | next |
| 1 | Schema migration + `sop-sync` CI pipeline + staff-app reader/ack + backoffice compliance matrix | after ~5 docs are in use |
| 2 | Checklist linking surfaced in UI; review-cycle automation (scheduled routine flags docs past `nextReviewAt`, opens a draft-update PR); onboarding packs (new hire must ack a doc-set within X days) | follows |
| 3 | Quiz ack-gates; Gosame system onboarding (auth + RLS scoping — the real multi-tenant lift); in-app editor if ever needed | on demand |

Rollout principle: document what already happens, 2–3 docs/week, each through
draft → owner review → publish v1.0 → team briefing → acknowledgment (paper
sign-sheet or Google Form until phase 1) → review date set. Software absorbs a
working system; it doesn't substitute for one.

## Open questions

1. Gosame's domain map — needs the owner to describe the business.
2. Do the companies share functions in practice (finance/HR person)? Decides
   whether `GRP-` documents exist or the manuals stay fully independent.
3. Bahasa policy per document: EN master with BM staff-facing versions is the
   default assumption (`language` front-matter field exists); confirm per domain.
