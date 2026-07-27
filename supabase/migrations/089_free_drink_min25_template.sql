-- Gated Free Drink for the Welcome loop (applied live 2026-07-18): clone of
-- the ungated template (9cb1a485) with min_order_value=25, so the freebie
-- always rides a basket. The ungated original stays for Birthday (a gift with
-- strings is off-brand; tiny volume, and now COGS-costed in measurement).
-- 217 ungated welcome vouchers already in wallets stay valid (promised);
-- their rounds measure with true-margin accounting -> free ungated-vs-gated read.
INSERT INTO voucher_templates (
  id, brand_id, title, description, icon, category, discount_type,
  scope, target_ids, applicable_categories, min_order_value,
  validity_days, stacks_with_beans, stacks_with_other, is_active, auto_issue
)
SELECT
  'a0000025-0000-4000-8000-000000000025', brand_id,
  'Free Drink (spend RM25)', 'Any regular drink free with an RM25+ order',
  icon, category, discount_type, scope, target_ids, applicable_categories,
  25, validity_days, stacks_with_beans, stacks_with_other, true, false
FROM voucher_templates WHERE id = '9cb1a485-4e68-46a9-a8f1-0dec4519c641'
ON CONFLICT (id) DO NOTHING;
