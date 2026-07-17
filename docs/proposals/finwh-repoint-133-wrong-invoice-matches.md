# Proposal: re-point the 133 wrong-invoice bank-line matches

2026-07-17, finance-warehouse run 2. **PROPOSE-ONLY — nothing here has been
executed.** Needs finance approval (CLAUDE.md hard rule 6: payments-adjacent).
Detection query and counts are reproducible; see the finance-warehouse skill,
check 11b.

## What these are

133 non-manual `BankStatementLine` rows are linked (`apInvoiceId`) to an
invoice whose number does NOT appear in the bank narration, while a
*different* invoice's number (≥5 chars) DOES appear in it. This is the
historical same-amount wrong-invoice class first seen 2026-07-10 (312/1049
matches; 6 hand-corrected 2026-07-14 — this batch is the remainder).

## Tiers

| Tier | Rule | Count | Amount |
| --- | --- | --- | --- |
| 1 — auto re-point | narrated invoice exists AND `amount` equals the line exactly | 92 | RM 30,470.60 |
| 2 — manual review | narrated invoice exists but amount differs (partials, multi-invoice payments) | 40 PAID + 1 DEPOSIT_PAID | RM 21,251.98 |

## Tier-1 SQL (run only after approval)

Follows the 2026-07-14 precedent: re-pointed lines get `classifiedBy='manual'`
so the matcher never re-touches them; an audit note is stamped on the row.

```sql
begin;
with candidates as (
  select b.id as line_id, li.id as wrong_id, li."invoiceNumber" as wrong_no,
         o.id as right_id, o."invoiceNumber" as right_no
  from "BankStatementLine" b
  join "Invoice" li on li.id = b."apInvoiceId"
  join lateral (
    select o.* from "Invoice" o
    where o.id <> li.id and o."invoiceNumber" is not null
      and length(o."invoiceNumber") >= 5
      and position(o."invoiceNumber" in b.description) > 0
    order by (o.amount = b.amount) desc, o."issueDate" desc
    limit 1
  ) o on true
  where b."classifiedBy" <> 'manual'
    and li."invoiceNumber" is not null and length(li."invoiceNumber") >= 5
    and position(li."invoiceNumber" in b.description) = 0
    and o.amount = b.amount
)
update "BankStatementLine" b
set "apInvoiceId" = c.right_id,
    "classifiedBy" = 'manual',
    notes = coalesce(notes,'')
      || ' [finwh-repoint 2026-07-17: narration names ' || c.right_no
      || ', was linked to ' || c.wrong_no || ']'
from candidates c
where b.id = c.line_id;
-- expect 92 rows
commit;
```

Reviewer cautions:
- The lateral picks ONE narrated invoice per line (amount-match first, newest
  issue date as tiebreak). Lines whose narration quotes two invoice numbers
  should be eyeballed in tier 2 style if the count above deviates from 92.
- If two lines re-point to the SAME invoice, one of them is probably a
  duplicate settlement — the post-run integrity query below surfaces this.

## After tier 1: orphaned "paid" evidence

Invoices that LOSE their only supporting bank line and were marked paid by
the matcher (`paidVia='bank-ap-match'`) may be phantom-paid (the 2026-07-14
KLFC 00653452 pattern). Review list, not auto-reverted:

```sql
select i.id, i."invoiceNumber", i."vendorName", round(i.amount,2) as amount,
       i."paidAt"::date, i.status
from "Invoice" i
where i.status = 'PAID' and i."paidVia" = 'bank-ap-match'
  and not exists (select 1 from "BankStatementLine" b where b."apInvoiceId" = i.id);
```

(As of 2026-07-17 this already returns 6 rows pre-batch — including INV-1012
RM768 paid 6/16 — which need the same review regardless.)

## Post-run integrity checks

```sql
-- duplicate settlements created by the batch
select "apInvoiceId", count(*) from "BankStatementLine"
where "apInvoiceId" is not null group by 1 having count(*) > 1
-- re-run warehouse check 11b: expect 41 (tier-2 residual), not 133
```

Tier 2 (41 lines, narrated invoice without exact amount) should be worked in
the exception/reconciliation UI with supplier SOAs at hand — partial payments
and multi-invoice transfers can't be auto-resolved safely.
