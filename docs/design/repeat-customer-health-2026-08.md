# Repeat-customer health — first read, 2026-08-29

First analysis of the repeat-customer ratio now that the POS captures customer
identity at the till. Covers **8 Jun – 29 Aug 2026** (POS go-live to today).

Report artifact: <https://claude.ai/code/artifact/1d5f77e6-be33-4bff-b4f4-81548859b7ad>

## Verdict

**The ratio is not healthy; the loyal core is.** They are separate findings and
only one is worth acting on.

- 81% of identified August customers visited exactly once. Repeat customers are
  **19.0% of customers and 38.7% of revenue** (RM 58,329 of RM 150,571). A
  settled café normally runs repeat >60% of revenue.
- But a fixed cohort holds: of the 1,246 customers first seen in June, 31.1%
  were active in July and **28.3% in August**, at 3.4 visits/month. The curve
  flattens instead of bleeding out.
- Conclusion: not a loyalty problem — a **first-repeat-visit** problem. The
  ratio is decided in the ~14 days after a customer's first visit.

## The measurement trap (read before trusting any trend)

Till identification climbed **31.4% → 55.0% → 71.1%** of POS orders across
Jun/Jul/Aug. This confounds every naive repeat metric in both directions:

- Rising coverage progressively captures *lower-frequency* customers (a weekly
  regular gets captured early simply because they visit often; the monthly
  visitor gets captured late). So each new cohort is drawn from a
  lower-frequency pool and its return rate falls **with nothing real
  changing** — classic length-biased sampling.
- Meanwhile "share of visits from returning customers" rises mechanically
  (34.8% → 46.4% → 48.8%) just because the identified base accumulates history.

**Do not report either as a trend without the control below.**

### The control test

Outlets ramped coverage at different rates, so coverage change and return
change can be separated. Shah Alam is the natural control:

| Outlet | ID coverage Jun → Aug | Δ coverage | 14-day return Jun → Aug | Δ return |
| --- | --- | --- | --- | --- |
| Shah Alam | 60% → 76% | +16 pts | 22.9% → 12.2% | −10.7 pts |
| Conezion | 18% → 73% | +55 pts | 21.8% → 12.5% | −9.3 pts |
| Tamarind | 22% → 63% | +41 pts | 20.0% → 12.2% | −7.8 pts |

Shah Alam's coverage barely moved yet its return rate still halved. **A real
decline exists underneath the artefact.** The fleet-wide weekly 14-day return
fell 31.8% (wk 8 Jun) → 13.4% (wk 10 Aug).

### The leaky bucket

Jul and Aug each acquired ~2,800–3,100 newly identified customers, yet daily
volume was flat: **273.4 → 268.0 orders/day**, RM 7,767 → RM 7,437 revenue/day
(day-of-month matched, ≤29th). New customers are replacing churned ones, not
adding to the base. Separately, only **7,201 of 26,800 members (26.9%)** have
transacted since POS go-live.

## August revenue concentration (identified customers)

| Visits in Aug | Customers | Visits | Revenue (RM) | % revenue |
| --- | --- | --- | --- | --- |
| 1 | 3,088 | 3,088 | 92,242 | 61.3% |
| 2–3 | 554 | 1,246 | 32,797 | 21.8% |
| 4–7 | 122 | 603 | 14,104 | 9.4% |
| 8+ | 48 | 591 | 11,428 | 7.6% |

## Recommendations

1. **Buy the second visit, not the first.** Next-visit reward issued at first
   identification, 14-day expiry, measured against a holdout. The holdout
   design in `sms-loop-engineering.md` is the right vehicle — it still needs
   the two owner decisions (exact reward + success bar).
2. **Work the 2–3 visit band** — 554 customers already carrying 21.8% of
   revenue, cheaper to move than acquiring one-timers.
3. **Get Tamarind past ~70% till identification.** Until all three outlets
   clear it, cross-outlet cohort comparisons measure the till, not the customer.
4. **Switch the north-star to repeat *share of revenue*** (38.7%) rather than
   repeat rate of customers — far less sensitive to the identification ramp.

## Caveats

- Identified customers only (71% of Aug till orders). Anonymous traffic skews
  one-off, so the true all-traffic repeat ratio is likely **lower**, not higher.
  Bound on repeat share of visits: 39% (all anonymous are one-off) to 49%
  (anonymous behave like identified).
- One-month windows understate repeat for >30-day visit cycles; the cohort
  charts are the corrective.
- POS data starts 8 Jun, so the June cohort is left-truncated — it includes
  pre-existing regulars appearing for the first time. Its retention is a
  ceiling, not a baseline.
- August cohorts are excluded from all return-rate comparisons (14-/30-day
  windows have not closed).
- Data integrity checked: 0 duplicate normalised phones, 0 malformed phones,
  1 POS loyalty phone unmatched in `members` out of 11,736 identified visits.

## Reproducing it

Identity is `members.id`, resolved from `pos_orders.loyalty_phone` via
`members.phone`, unioned with `orders.loyalty_id` (app + QR-table). Only
`status='completed'` rows count.

```sql
-- the unified visit set every metric below is built on
with visits as (
  select coalesce(m.id, 'ph:'||p.loyalty_phone) as cust, p.created_at, p.total
  from pos_orders p
  left join members m on m.phone = p.loyalty_phone
  where p.loyalty_phone is not null and p.status = 'completed'
  union all
  select coalesce(o.loyalty_id, 'ph:'||o.loyalty_phone), o.created_at, o.total
  from orders o
  where o.status = 'completed'
    and (o.loyalty_id is not null or o.loyalty_phone is not null)
)
select * from visits;
```

```sql
-- cohort survival: the one read immune to the coverage ramp
with visits as (/* as above */),
f as (select cust, min(created_at) fst from visits group by cust),
cohort as (select cust from f where fst >= '2026-06-08' and fst < '2026-07-01')
select date_trunc('month', v.created_at)::date as mth,
       count(distinct v.cust) as active,
       round(100.0*count(distinct v.cust)/(select count(*) from cohort), 1) as pct_active,
       round(count(*)::numeric/count(distinct v.cust), 2) as visits_per_active
from visits v join cohort c on c.cust = v.cust
where v.created_at >= '2026-06-08'
group by 1 order by 1;
```

```sql
-- identification coverage: always report this beside any repeat metric
select outlet_id, date_trunc('month', created_at)::date as mth,
       count(*) as orders,
       round(100.0*count(loyalty_phone)/count(*), 1) as pct_identified
from pos_orders where status = 'completed'
group by 1, 2 order by 1, 2;
```

## Lessons

- `pos_orders.status` is effectively always `completed` (21,178 of 21,179 rows);
  `orders` carries a real `failed` state (1,249 rows) that must be excluded.
- Discounted first visits return *better* (24.0% vs 15.6% in July), but that is
  reverse causation — the discounts are tier benefits (Silver/Gold/Platinum/
  Black) and bundle promos, awarded to people who are already loyal. There is no
  acquisition-discount lever in this data.
- First-visit ticket size is stable across cohorts (~RM 30), so the falling
  return rate is not explained by cheaper/deal-seeking new customers.
- The Prisma `Order` model is procurement POs. Customer orders live in the
  SQL-managed Supabase tables `orders` (app/QR) and `pos_orders` (till) — do not
  confuse them.
