# Statutory & tax compliance

Employer/tax registrations and recurring statutory obligations — now for
**three entities** (see `company.md`). Monthly payroll *execution*
(EPF/SOCSO/EIS/PCB submissions) is the HR module's job — see
`docs/hr-payroll-spec.md` (note: payroll currently runs under Celsius Coffee
Sdn. Bhd. only, single-entity). This file records the registrations, who is
responsible, and calendar obligations; dates go in `renewals.md`.

⚪ = pre-filled 2026-08-31 from the estate — verify.

## Registrations — per entity

| Registration | Celsius Coffee | Conezion | Tamarind | Notes |
| --- | --- | --- | --- | --- |
| LHDN tax file (C) | | | | |
| TIN (MyInvois) | ⚪ not on record | ⚪ not on record | ⚪ not on record | `fin_companies.tin` NULL for all three — needed before any e-invoice filing |
| Employer no. (E) | | | | |
| EPF employer | | | | payroll runs under Celsius Coffee only |
| SOCSO/EIS employer | | | | |
| SST | ⚪ not on record | ⚪ not on record | ⚪ not on record | confirm registered vs below-threshold per entity |
| HRD Corp | | | | |

## E-invoice (MyInvois) — ⚠️ open compliance question

From `docs/design/einvoice-live-sources.md` (verified 2026-08-15): the
system has submitted **zero** e-invoices; Celsius Coffee Sdn. Bhd.'s ~RM2.5M
2025 revenue puts it in the RM1–5M band — mandatory since **1 Jan 2026**,
grace ended ~Jun 2026. Conezion/Tamarind (2026 entities) follow their own
thresholds.

**Owner/accountant to answer:** is the accountant filing consolidated
e-invoices via the MyInvois portal for each entity? Since when, and for
which months? If not, interim manual filing should start now (monthly
consolidated, due day 7 of the following month).

## External professionals

| Role | Firm / name | Contact | Fees |
| --- | --- | --- | --- |
| Auditor | | | |
| Tax agent | | | |
| Company secretary | | | see `company.md` |

## Annual calendar

| When | Obligation | Entity | Responsible | Notes |
| --- | --- | --- | --- | --- |
| Day 7 monthly | Consolidated e-invoice (prior month) | ×3 | ⚪ unconfirmed | see open question above |
| _PENDING_ | Form C / tax filing | ×3 | | |
| _PENDING_ | Audit + AGM / annual return | ×3 | | cosec to confirm anniversary dates |
| Jan–Feb | Form E / EA forms | employer entities | | HR module assists |
