# Mystery rewards — loop health (measurement)

Mystery drops fire on every paid order; the goal is that a win **pulls the next
order**. Two leak points, both measurable.

## Baseline (60 days, measured 2026-06-22)
| Step | Value | Read |
|---|---|---|
| Drops | 946 | every paid order spins |
| Revealed (tapped) | **67.5%** | ~1/3 never reveal → win stranded |
| Voucher wins | 339 (242 issued once revealed) | |
| **Vouchers redeemed** | **14.5%** (35/242) | the loop barely closes |
| Expired unused | 14 | |

The reveal lives only on the order screen, so a customer who doesn't revisit
never taps — and an **unrevealed win never becomes a voucher**, so it can never
be redeemed. That's the upstream leak the home "reward waiting" banner targets
(deep-links to the reveal). Redemption (14.5%) is the downstream leak — the
return pull (expiring-reward "order now" urgency) is the next lever.

## Report queries (run in Supabase / execute_sql)
```sql
-- Funnel (last 60d)
SELECT
  (SELECT count(*) FROM mystery_drops WHERE created_at > now()-interval '60 days') AS drops,
  (SELECT round(100.0*avg((revealed_at IS NOT NULL)::int),1) FROM mystery_drops WHERE created_at > now()-interval '60 days') AS revealed_pct,
  (SELECT count(*) FROM issued_rewards WHERE source_type='mystery' AND issued_at > now()-interval '60 days') AS vouchers_issued,
  (SELECT round(100.0*avg((status='used')::int),1) FROM issued_rewards WHERE source_type='mystery' AND issued_at > now()-interval '60 days') AS redeemed_pct;
```
Track `revealed_pct` (should climb with the home reveal banner) and
`redeemed_pct` (should climb with the return pull).
