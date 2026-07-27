# HR data & login audit — 2026-07-26

Baseline completeness audit of all 51 ACTIVE staff/managers (prod, SQL-verified),
run as task 1 of the HR Ops Agent plan (docs/design/hr-ops-agent.md). This file
is the seed backlog for the agent's data-completeness chaser; strike lines as
they resolve. Gap flags only — no IC/bank/EPF values in this doc.

## Fixed during the audit (2026-07-26)

- ✅ DOB derived from IC on file: ABIE AIFA, Nurul Aqilah, AIMI NADHIRA,
  MUHAMAD FARHAN IKHMAL, Fatin (century rule YY≤26→20YY).
- ✅ Nor Hadi Abdullah: `appAccess` was empty (login/clock-in blocker) →
  granted crew apps `['ops','inventory']`; moduleAccess already present.
- ✅ Haziq PT: floater position "PT Barista/Kitchen" → stations `foh+boh`,
  manager → Adam Kelvin (was null).
- ✅ (Earlier this arc) 8 foh/boh staff backfilled under Adam Kelvin; PINs set
  for the four July hires; Absah's missing details filled; Danish FT→PT split.

## Login / clock-in blockers (3 people)

| Staff | Blockers | Action needed |
| --- | --- | --- |
| Anwar (IOI, PT Barista) | **No PIN, no phone** | Owner/HOO assign PIN; collect phone (also needed for WhatsApp agent identity) |
| Anis (Executive) | No PIN, no appAccess, no outlet, no manager, no IC/DOB/bank | Confirm role: HQ (backoffice-only, no clock-in) or floor? Then provision accordingly |
| Shella | No PIN, no appAccess, no outlet, no position, **phone is a BrioHR import placeholder** (`+60-briohr-063`), no IC | Confirm still employed + role; complete or deactivate |

Everyone else (48/51) has PIN + app access + outlet → can log in and clock in.

## Data-quality flags (need a human decision)

1. **Muhammad Adam Irfan (IOI Mall)** — empty position, no stations/manager/
   IC/bank on the ACTIVE record; a DEACTIVATED BrioHR-import twin exists with
   position Barista, salary, and EPF. Likely a duplicate pair → confirm and
   merge details onto the active record.
2. **Managers have no outlet** (Adam Kelvin, Ariff, Chef Bo, Syafiq) —
   presumed intentional (multi-outlet). Confirm once; note here.
3. **appAccess vocabulary drift** — fleet mixes `staff`, `staff_app`, and the
   preset `ops/inventory` sets. Recommend one run of the staff-access-presets
   normalize pass (see `lib/staff-access-presets.ts`) — propose-only, since it
   touches live access.
4. **Employer EPF rate stored as 12% fleet-wide** for FT staff; statutory rate
   for wages ≤ RM5k is 13%. Needs one finance decision + fleet correction.

## Chase list — needs info from staff (agent's chaser backlog)

### Bank details missing (19) — payroll blocker, chase first
FT/contract: Firdaus, Guraf Lal Joshi, Hafifie, Hidayat, Nur Nazihah,
Nur Iffa Sofea, Nurul Alianatasha, Muhammad Akmal Aiman, Muhammad Adam Irfan,
Nor Hadi Abdullah, Chef Bo, Anis.
PT: Anwar, ABIE AIFA, AIMI NADHIRA, MUHAMAD FARHAN IKHMAL, Fatin,
NUR QAISARA FARHANAH, Yaya PT.

### EPF number missing on FT staff (statutory-critical, 10)
Nur Nazihah, Firdaus, Guraf Lal Joshi*, Haziq (Kitchen Lead PJ), Hidayat,
Nur Iffa Sofea, Nurul Alianatasha, Muhammad Akmal Aiman, Muhammad Adam Irfan,
Amirul Yazid.
*Guraf: confirm nationality — non-citizen ⇒ EPF category C / SOCSO category 2,
not a missing-EPF chase.

### IC missing (16)
Anwar, Firdaus, Hidayat, Afique, Muhammad Adam Irfan, Aiman, Alea, Elainiey,
Emran, Farah, Hadif, Naufal, Qaseh, Yaya PT, Anis, Shella.
(IC unlocks DOB + gender derivation automatically.)

### Emergency contact missing (~40 of 51)
Fleet-wide — this is the staff-persona self-service win: the agent asks each
staff member directly ("who should we call in an emergency?"). Don't chase via
managers.

## Documents

- LOE on file: **21 of 51**; 30 staff have no documents at all.
  Chase = signed LOE per staff (agent's document chaser).
- Auni Sefhia's signed LOE is parsed and ready but **upload is blocked**:
  session egress policy denies `kqdcdhpnyuwrxqhbuyfl.supabase.co`, so Storage
  writes can't leave this environment. Human action: upload via backoffice →
  HR → Auni → Documents (type LOE), or allowlist the host for agent sessions.
  The same allowlist gap will block the HR agent's own document intake — fix
  before implementation.

## Standing rule for closure

A staff record is "in order" when: PIN + app access + outlet + profile +
IC + DOB + gender + bank + (EPF if FT) + emergency contact + manager +
stations + signed LOE in the vault. Current fully-complete count: **9 of 51**.
