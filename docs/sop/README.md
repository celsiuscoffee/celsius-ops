# Company SOP manuals

The operating manuals for **Celsius Coffee** (`celsius/`) and **Gosame**
(`gosame/`) — company-level policies, procedures, work instructions, and forms.
This is NOT the staff-app checklist feature; that system is the execution layer
for the Tier-3 documents here (see `docs/design/sop-module.md`).

**Source of truth is this folder.** Authoring and approval happen through PRs;
git history is the revision history. A CI sync to the database (staff-app
reader + acknowledgments) comes in phase 1.

## How it works

- Every document follows [`TEMPLATE.md`](TEMPLATE.md) and the rules in
  [`CC-GOV-001 Document Control`](celsius/GOV/CC-GOV-001-document-control.md)
  — read that first; it is the SOP for SOPs.
- [`REGISTRY.md`](REGISTRY.md) is the master index. Every document — planned,
  drafted, or published — has a row there. Update it in the same PR as the
  document change.
- Document ID: `{company}-{domain}-{number}`, e.g. `CC-FIN-003`.
  File name: `{ID}-{kebab-title}.md` inside `{company}/{DOMAIN}/`.

## Domains

| Code | Chapter |
|---|---|
| GOV | Governance — org, authority matrix, document control |
| OPS | Outlet operations — open/close, service, hygiene, incidents |
| PRD | Product & kitchen — recipes, prep, calibration, NPD |
| HR | People — hiring, onboarding, training, payroll cycle, discipline |
| FIN | Finance — cash, payments, claims, close, reconciliation |
| PROC | Procurement & inventory — suppliers, ordering, receiving, counts |
| MKT | Marketing & customer — promos, loyalty, reviews, brand |
| IT | Technology — system access, provisioning, data |
| CMP | Compliance & safety — licensing, halal, fire safety, OSH |

Gosame's domain map is TBD — set it when its manual starts (`gosame/README.md`).
