-- 113_restore_q4_demoted_tiers.sql
--
-- STATUS: NOT YET APPLIED — awaiting owner approval. Run AFTER 112.
--
-- One-off data repair for the 2026-10-01 rollover bug fixed in 112. Members
-- demoted at their first Q4 visit now hold a lock to 2027-01-01, so the fixed
-- function will not revisit them until Q1 (a locked member only upgrades on
-- current-quarter spend). Restore them explicitly.
--
-- Rule (mirrors 112): tier = highest non-invitation tier whose min_spend <=
-- Q3-2026 net spend (RM, net of SST, orders + pos_orders, same statuses as the
-- function). UPGRADE ONLY: nobody moves down, invitation tiers (Staff, Black
-- Card) are never touched. Lock to the Q4 end, as the function would.
-- Sized 2026-11-11: 102 rows (61 Member->Silver, 24 Member->Gold,
-- 11 Silver->Gold, 3 Gold->Platinum, 2 Silver->Platinum, 1 Member->Platinum).
--
-- Reversible: the previous tier of every changed row is kept in
-- member_brands_tier_restore_20261111.

BEGIN;

CREATE TABLE IF NOT EXISTS public.member_brands_tier_restore_20261111 AS
SELECT mb.id, mb.member_id, mb.brand_id,
       mb.current_tier_id   AS old_tier_id,
       mb.tier_evaluated_at AS old_evaluated_at,
       mb.tier_locked_until AS old_locked_until,
       NULL::text           AS new_tier_id,
       NULL::numeric        AS q3_spend_rm
FROM public.member_brands mb
WHERE false;

-- Backup table lives in `public`, which PostgREST exposes: deny API roles.
ALTER TABLE public.member_brands_tier_restore_20261111 ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.member_brands_tier_restore_20261111 FROM anon, authenticated;
  END IF;
END $$;

WITH spend AS (
  SELECT m.id AS member_id, SUM(x.net_sen)::numeric / 100.0 AS q3_rm
  FROM public.members m
  JOIN (
    SELECT o.loyalty_id AS mid, NULL::text AS phone,
           GREATEST(o.total - COALESCE(o.sst_amount, 0), 0) AS net_sen
    FROM public.orders o
    WHERE o.status IN ('completed', 'paid', 'preparing', 'ready')
      AND o.created_at >= '2026-07-01 00:00:00+00'
      AND o.created_at <  '2026-10-01 00:00:00+00'
    UNION ALL
    SELECT NULL, po.loyalty_phone,
           GREATEST(po.total - COALESCE(po.sst_amount, 0), 0)
    FROM public.pos_orders po
    WHERE po.status = 'completed'
      AND po.loyalty_phone IS NOT NULL
      AND po.created_at >= '2026-07-01 00:00:00+00'
      AND po.created_at <  '2026-10-01 00:00:00+00'
  ) x ON x.mid = m.id OR x.phone = m.phone
  GROUP BY m.id
),
target AS (
  SELECT mb.id, mb.member_id, mb.brand_id, mb.current_tier_id,
         mb.tier_evaluated_at, mb.tier_locked_until,
         t.id AS new_tier_id, s.q3_rm
  FROM public.member_brands mb
  JOIN spend s ON s.member_id = mb.member_id
  LEFT JOIN public.tiers ct ON ct.id = mb.current_tier_id
  JOIN LATERAL (
    SELECT t.* FROM public.tiers t
    WHERE t.brand_id = mb.brand_id AND t.is_active AND NOT t.invitation_only
      AND t.min_spend <= s.q3_rm
    ORDER BY t.sort_order DESC LIMIT 1
  ) t ON true
  WHERE NOT COALESCE(ct.invitation_only, false)
    AND t.sort_order > COALESCE(ct.sort_order, 0)
),
saved AS (
  INSERT INTO public.member_brands_tier_restore_20261111
  SELECT id, member_id, brand_id, current_tier_id, tier_evaluated_at,
         tier_locked_until, new_tier_id, q3_rm
  FROM target
  RETURNING id, new_tier_id
)
UPDATE public.member_brands mb
SET current_tier_id   = saved.new_tier_id,
    tier_evaluated_at = NOW(),
    tier_locked_until = '2027-01-01 00:00:00+00'
FROM saved
WHERE mb.id = saved.id;

-- Expect 102 (± members who upgraded or spent since 2026-11-11).
SELECT t.name AS restored_to, COUNT(*)
FROM public.member_brands_tier_restore_20261111 r
JOIN public.tiers t ON t.id = r.new_tier_id
GROUP BY 1 ORDER BY 2 DESC;

COMMIT;

-- Rollback (if ever needed):
-- UPDATE public.member_brands mb
-- SET current_tier_id = r.old_tier_id,
--     tier_evaluated_at = r.old_evaluated_at,
--     tier_locked_until = r.old_locked_until
-- FROM public.member_brands_tier_restore_20261111 r WHERE mb.id = r.id;
