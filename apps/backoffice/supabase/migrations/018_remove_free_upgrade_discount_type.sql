-- APPLIED to production 2026-06-12 (Supabase migration
-- remove_free_upgrade_discount_type).
--
-- Remove the free_upgrade discount type (the chain sells no upgrades;
-- the single "Free Add-on" template never issued a voucher and is
-- referenced by no mission / mystery pool / claimable — verified
-- against live data). Also fixes a latent mismatch: the old CHECK
-- rejected bogo / combo / override_price, which the engine and the
-- admin RewardForm both support — saving one of those templates would
-- have failed at the database.
--
-- Code removal in the same commit: engine case + type unions +
-- legacyDescriptorToSpec mapping (@celsius/shared), the POS and pickup
-- native ports, admin form option, and display fallbacks. Residual
-- 'free_upgrade' values anywhere degrade gracefully: the engine's
-- default branch returns unsupported_discount_type / 0 discount.

-- Neutralize the orphan template BEFORE tightening the constraint
-- (a new CHECK validates existing rows).
UPDATE voucher_templates
SET discount_type = 'none', is_active = false
WHERE discount_type = 'free_upgrade';

ALTER TABLE voucher_templates
  DROP CONSTRAINT voucher_templates_discount_type_check;

ALTER TABLE voucher_templates
  ADD CONSTRAINT voucher_templates_discount_type_check CHECK (
    discount_type = ANY (ARRAY[
      'flat'::text, 'percent'::text, 'free_item'::text,
      'bogo'::text, 'combo'::text, 'override_price'::text,
      'beans_multiplier'::text, 'none'::text
    ])
  );
