# Challenge cart-nudge — measurement (holdout A/B)

Proves whether the cart AOV challenge nudge ("Spend RMx more to unlock …")
actually lifts AOV/frequency, vs. members who'd have qualified anyway.

## How it works
- `challenge_nudge_holdout` flag in `app_settings`: `{enabled, pct}` (default
  `{enabled:true, pct:20}`).
- On a member's **first eligible cart moment** (there's a nudge to show), the
  cart-challenge endpoint assigns a stable variant via `resolveNudgeVariant`
  and stores it in `challenge_nudge_assignment` (random by `pct`).
- **Holdout** members get `{challenge:null}` — they never see the nudge.
- **Treatment** members see it. Both groups reached the same nudge-able cart, so
  the only difference is the nudge → a clean A/B.
- Turn it off once proven: set the flag `enabled:false` (or `pct:0`) → everyone
  gets the nudge; assignments are kept for historical comparison.

## Report (run in Supabase / execute_sql)
```sql
WITH paid AS (
  SELECT a.variant, a.member_id, o.id AS order_id, o.subtotal,
         (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS items
  FROM challenge_nudge_assignment a
  JOIN orders o ON o.loyalty_id = a.member_id
  WHERE o.total > 0 AND o.created_at >= a.assigned_at
),
members AS (SELECT variant, count(*) AS members FROM challenge_nudge_assignment GROUP BY variant)
SELECT m.variant, m.members,
  count(p.order_id)                                          AS orders,
  round(count(p.order_id)::numeric / NULLIF(m.members,0), 2) AS orders_per_member,  -- frequency
  round(avg(p.subtotal)::numeric, 2)                          AS aov_subtotal,       -- AOV
  round(100.0 * avg((p.items = 1)::int), 1)                   AS single_item_pct
FROM members m
LEFT JOIN paid p ON p.variant = m.variant
GROUP BY m.variant, m.members
ORDER BY m.variant;
```

Read it as: treatment vs holdout on **aov_subtotal** (basket lift) and
**orders_per_member** (frequency). A positive gap = the nudge is working.

## Caveat
Low order volume → the gap needs time to reach significance. Let it run a few
weeks before concluding; don't kill on a handful of orders.
