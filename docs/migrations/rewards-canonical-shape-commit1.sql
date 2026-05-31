-- Rewards refactor — Commit 1: canonical shape (additive) — applied 2026-05-31
-- Spec: docs/rewards-storehub-refactor.md
--
-- Purely additive. Adds the canonical 6-field eligibility shape + the
-- type-specific knobs to voucher_templates, adds template_id to
-- issued_rewards, mirrors the 3 legacy `rewards` catalog rows into
-- voucher_templates (with points_cost), and backfills template_id on
-- every active issued voucher. Zero customer-visible behaviour change —
-- the rewards catalog table is untouched (it drops in Commit 3 after
-- readers cut over).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, deterministic UUIDs for the
-- catalog mirrors (uuid_generate_v5), and WHERE … IS NULL guards on the
-- backfills mean re-running is a no-op.
--
-- Applied via Supabase MCP against project kqdcdhpnyuwrxqhbuyfl.
-- Acceptance gates (all returned 0 failures): see bottom of file.

-- ── Step 1: schema additions ───────────────────────────────────────
ALTER TABLE voucher_templates
  ADD COLUMN IF NOT EXISTS scope               text,
  ADD COLUMN IF NOT EXISTS target_ids          text[],
  ADD COLUMN IF NOT EXISTS modifier_filter     jsonb,
  ADD COLUMN IF NOT EXISTS points_cost         integer,
  ADD COLUMN IF NOT EXISTS image_url           text,
  ADD COLUMN IF NOT EXISTS stock               integer,
  ADD COLUMN IF NOT EXISTS max_per_member      integer,
  ADD COLUMN IF NOT EXISTS valid_from          timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until         timestamptz,
  ADD COLUMN IF NOT EXISTS bogo_buy_qty        integer,
  ADD COLUMN IF NOT EXISTS bogo_free_qty       integer,
  ADD COLUMN IF NOT EXISTS override_price_sen  integer,
  ADD COLUMN IF NOT EXISTS combo_price_sen     integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'voucher_templates_scope_check'
  ) THEN
    ALTER TABLE voucher_templates
      ADD CONSTRAINT voucher_templates_scope_check
      CHECK (scope IS NULL OR scope IN ('everything','products','categories'));
  END IF;
END $$;

ALTER TABLE issued_rewards
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES voucher_templates(id);

-- ── Step 2: backfill scope + target_ids on existing voucher_templates ─
-- Derivation: free_product_ids → applicable_products → applicable_categories
-- → everything. free_product_name (free text) is intentionally dropped.
UPDATE voucher_templates SET
  scope = CASE
    WHEN free_product_ids      IS NOT NULL AND array_length(free_product_ids, 1)      > 0 THEN 'products'
    WHEN applicable_products   IS NOT NULL AND array_length(applicable_products, 1)   > 0 THEN 'products'
    WHEN applicable_categories IS NOT NULL AND array_length(applicable_categories, 1) > 0 THEN 'categories'
    ELSE 'everything'
  END,
  target_ids = CASE
    WHEN free_product_ids      IS NOT NULL AND array_length(free_product_ids, 1)      > 0 THEN free_product_ids
    WHEN applicable_products   IS NOT NULL AND array_length(applicable_products, 1)   > 0 THEN applicable_products
    WHEN applicable_categories IS NOT NULL AND array_length(applicable_categories, 1) > 0 THEN applicable_categories
    ELSE NULL
  END
WHERE scope IS NULL;

-- ── Step 3: mirror the 3 rewards-catalog rows into voucher_templates ──
-- Deterministic UUID per legacy text id so re-runs no-op. Title suffix
-- "(Bean Shop)" distinguishes the points-shop mirror from any existing
-- same-named template that fires from mystery/mission paths.
INSERT INTO voucher_templates (
  id, brand_id, title, description, icon, category,
  discount_type, discount_value, max_discount_value, min_order_value,
  applicable_categories, applicable_products, free_product_ids, free_product_name,
  scope, target_ids,
  points_cost, image_url, stock, validity_days, max_per_member,
  bogo_buy_qty, bogo_free_qty,
  is_active, stacks_with_beans, stacks_with_other
)
SELECT
  uuid_generate_v5(uuid_ns_url(), 'rewards-catalog:' || r.id),
  r.brand_id,
  r.name || ' (Bean Shop)',
  COALESCE(r.description, ''),
  'ticket',
  CASE r.discount_type
    WHEN 'free_item'        THEN 'free_item'
    WHEN 'free_upgrade'     THEN 'upgrade'
    WHEN 'flat'             THEN 'discount'
    WHEN 'percent'          THEN 'discount'
    WHEN 'bogo'             THEN 'discount'
    WHEN 'combo'            THEN 'discount'
    WHEN 'override_price'   THEN 'discount'
    WHEN 'beans_multiplier' THEN 'multiplier'
    ELSE 'special'
  END,
  r.discount_type, r.discount_value, r.max_discount_value, r.min_order_value,
  r.applicable_categories, r.applicable_products, NULL, r.free_product_name,
  CASE
    WHEN r.applicable_products   IS NOT NULL AND array_length(r.applicable_products, 1)   > 0 THEN 'products'
    WHEN r.applicable_categories IS NOT NULL AND array_length(r.applicable_categories, 1) > 0 THEN 'categories'
    ELSE 'everything'
  END,
  CASE
    WHEN r.applicable_products   IS NOT NULL AND array_length(r.applicable_products, 1)   > 0 THEN r.applicable_products
    WHEN r.applicable_categories IS NOT NULL AND array_length(r.applicable_categories, 1) > 0 THEN r.applicable_categories
    ELSE NULL
  END,
  r.points_required, r.image_url, r.stock,
  COALESCE(r.validity_days, 30),  -- validity_days is NOT NULL on voucher_templates
  r.max_redemptions_per_member,
  r.bogo_buy_qty, r.bogo_free_qty,
  r.is_active, true, false
FROM rewards r
WHERE r.brand_id = 'brand-celsius'
ON CONFLICT (id) DO NOTHING;

-- ── Step 4: backfill issued_rewards.template_id (active rows) ─────────
-- 4a: catalog redemptions (text reward_id → mirror UUID)
UPDATE issued_rewards ir
   SET template_id = uuid_generate_v5(uuid_ns_url(), 'rewards-catalog:' || ir.reward_id)
 WHERE ir.brand_id = 'brand-celsius' AND ir.reward_id IS NOT NULL AND ir.template_id IS NULL
   AND EXISTS (SELECT 1 FROM voucher_templates t
                WHERE t.id = uuid_generate_v5(uuid_ns_url(), 'rewards-catalog:' || ir.reward_id));

-- 4b: mystery — source_ref_id → mystery_drops.id → pool_entry_id
--     → mystery_pool.voucher_template_id (2-hop)
UPDATE issued_rewards ir
   SET template_id = mp.voucher_template_id
  FROM mystery_drops md
  JOIN mystery_pool   mp ON mp.id = md.pool_entry_id
 WHERE ir.source_ref_id ~ '^[0-9a-f-]{36}$' AND ir.template_id IS NULL
   AND md.id = ir.source_ref_id::uuid AND mp.voucher_template_id IS NOT NULL;

-- 4c: mission — source_ref_id → mission_assignments.id → mission_id
--     → reward_missions.reward_voucher_template_ids[1] (2-hop)
UPDATE issued_rewards ir
   SET template_id = (rm.reward_voucher_template_ids)[1]::uuid
  FROM mission_assignments ma
  JOIN reward_missions     rm ON rm.id = ma.mission_id
 WHERE ir.source_ref_id ~ '^[0-9a-f-]{36}$' AND ir.template_id IS NULL
   AND ma.id = ir.source_ref_id::uuid
   AND rm.reward_voucher_template_ids IS NOT NULL
   AND array_length(rm.reward_voucher_template_ids, 1) > 0;

-- 4d: fallback for rows with a broken source chain (deleted pool entry
--     / removed mission). Conservative title + discount_type + value
--     match against an active non-bean-shop template.
UPDATE issued_rewards ir
   SET template_id = t.id
  FROM voucher_templates t
 WHERE ir.brand_id = 'brand-celsius' AND ir.status = 'active' AND ir.template_id IS NULL
   AND t.brand_id = 'brand-celsius' AND t.is_active = true AND t.points_cost IS NULL
   AND t.title = ir.title AND t.discount_type = ir.discount_type
   AND ((t.discount_value IS NULL AND ir.discount_value IS NULL) OR (t.discount_value = ir.discount_value));

-- ── Acceptance gates (each returns 0 on success) ─────────────────────
-- A: SELECT COUNT(*) FROM voucher_templates WHERE brand_id='brand-celsius' AND is_active AND scope IS NULL;          -- 0
-- B: 3 voucher_templates rows with points_cost IS NOT NULL.                                                          -- 3
-- C: SELECT COUNT(*) FROM issued_rewards WHERE brand_id='brand-celsius' AND status='active' AND template_id IS NULL; -- 0
-- D: 3 catalog redemptions (reward_id set) linked to a template.                                                     -- 3
-- E: 0 issued_rewards.template_id values that don't resolve to a voucher_templates row.                              -- 0
--
-- Post-migration counts: voucher_templates 14→17, voucher_templates
-- active 13→16, issued_rewards active w/ template_id 0→10, rewards
-- catalog 3→3 (untouched).
