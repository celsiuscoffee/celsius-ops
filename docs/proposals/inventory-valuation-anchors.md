# Inventory valuation anchors — accountant fill-in pack

2026-07-18, finance-warehouse custodian. The sourced P&L's COGS boundary
needs one known-good inventory valuation per outlet to anchor on
(`fin_inventory_valuations`, migration 082 — currently EMPTY). Without it,
actual COGS = purchases ± count movement with no trustworthy opening
value, and every month's actual-vs-recipe variance inherits that noise.

## What the accountant supplies (one line per outlet)

The **closing inventory value in RM** from the Bukku Q1 close (or the most
recent audited/accountant-signed valuation), per outlet company. Format —
just fill the blanks:

| Outlet | As-of date | Closing inventory (RM) | Source |
| --- | --- | --- | --- |
| Shah Alam | 2026-__-__ | RM ______ | bukku_q1_close |
| Putrajaya (Conezion) | 2026-__-__ | RM ______ | bukku_q1_close |
| Tamarind | 2026-__-__ | RM ______ | bukku_q1_close |

Rules:
- The as-of date must be the date the valuation was TAKEN for (typically
  the quarter-end), not the date it's being entered. DD/MM ambiguity has
  bitten before — write the month in words if unsure (e.g. "31 Mar 2026").
- If Bukku's close was one consolidated figure, say so — do NOT split it
  across outlets by guesswork; we'll anchor consolidated instead.
- Nilai (consignment) carries no inventory here — skip it.

## What happens next (agent, after values arrive)

The custodian enters them with a sanity gate before insert — each value is
checked against that outlet's trailing-30-day COGS purchases at the as-of
date; a value outside 0.3×–2× of a month's purchases is queried back, not
inserted. Insert shape (for transparency):

```sql
insert into fin_inventory_valuations (outlet_id, as_of, value, source, note)
values ('<outlet_id>', '<as_of>', <value>, 'bukku_q1_close', 'entered per accountant, <date>');
```

## Standing enforcement (already wired into the custodian)

- **Close pack gate:** the month-end close pack marks COGS as NOT
  TRUSTWORTHY and lists blockers when (a) any active outlet lacks a
  REVIEWED monthly stock count (≥85% coverage) for the closed month, or
  (b) no valuation anchor chain exists for the COGS boundary. The period
  still cannot close without the owner, and now the owner sees exactly
  which input is missing and whose it is.
- **Receiving conversion is now automatic:** the staff receiving API
  persists the PO line's package when the receiver doesn't pick one, so
  package coverage (check 21) ratchets up without behaviour change from
  staff. Ad-hoc receivings (no PO) still record base units.
- **Count discipline:** the coverage guard already blocks monthly counts
  below 85% (unless an explicit partial reason routes them to review).
  Outstanding housekeeping for the manager queue: 2 counts stuck
  SUBMITTED since 2026-04-30 and 5 DRAFTs need disposition — the close
  pack lists these until cleared.
