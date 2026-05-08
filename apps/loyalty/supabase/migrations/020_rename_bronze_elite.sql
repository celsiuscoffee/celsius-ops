-- Rename and recolor tiers to the new brand ladder:
--   Bronze → Member   (white  #FFFFFF — entry, welcoming)
--   Silver →  Silver  (silver #C0C0C0 — true metallic, was slate gray)
--   Gold   →  Gold    (gold   #D4AF37 — true metallic, was deep amber)
--   Elite  → Platinum (black  #000000 — top tier, premium obsidian)
--
-- Slugs stay as `bronze` / `silver` / `gold` / `elite` to preserve every
-- existing reference (UI styles keyed by slug, promotion targeting by
-- tier_id, analytics queries, hardcoded strings, expired migration
-- history). Only the user-facing `name` and `color` columns change.

UPDATE tiers SET name = 'Member',   color = '#FFFFFF' WHERE id = 'tier-celsius-bronze';
UPDATE tiers SET                    color = '#C0C0C0' WHERE id = 'tier-celsius-silver';
UPDATE tiers SET                    color = '#D4AF37' WHERE id = 'tier-celsius-gold';
UPDATE tiers SET name = 'Platinum', color = '#000000' WHERE id = 'tier-celsius-elite';

-- Refresh benefit copy that referenced the old tier names. Search the
-- JSONB benefits array on each tier and rewrite "Everything in Bronze"
-- / "Everything in Elite" / "Exclusive Elite events" to the new names.
-- Idempotent.
UPDATE tiers
   SET benefits = (
     SELECT to_jsonb(array_agg(
       CASE
         WHEN b LIKE '%Everything in Bronze%' THEN replace(b, 'Bronze', 'Member')
         WHEN b LIKE '%Everything in Elite%'  THEN replace(b, 'Elite',  'Platinum')
         WHEN b LIKE '%Exclusive Elite%'      THEN replace(b, 'Elite',  'Platinum')
         ELSE b
       END
     ))
     FROM jsonb_array_elements_text(benefits) AS b
   )
 WHERE brand_id = 'brand-celsius'
   AND (
     benefits::text LIKE '%Everything in Bronze%'
     OR benefits::text LIKE '%Everything in Elite%'
     OR benefits::text LIKE '%Exclusive Elite%'
   );

-- Promotion + reward names that exposed "Elite" to the customer at
-- checkout / in the rewards list.
UPDATE promotions
   SET name = 'Platinum member — 10% off',
       description = REPLACE(description, 'Elite-tier', 'Platinum-tier')
 WHERE id = 'promo-elite-10pct';

UPDATE rewards
   SET name        = REPLACE(name,        'Elite', 'Platinum'),
       description = REPLACE(description, 'Elite', 'Platinum')
 WHERE brand_id = 'brand-celsius'
   AND (name LIKE '%Elite%' OR description LIKE '%Elite%');
