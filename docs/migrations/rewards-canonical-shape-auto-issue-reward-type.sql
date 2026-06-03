-- Rewards refactor — auto_issue + reward_type on voucher_templates — applied 2026-06-03
-- Spec: docs/rewards-storehub-refactor.md ; plan: consolidate redemption across channels
--
-- Phase 3 of the cross-channel rewards consolidation gets apps/order off
-- the legacy `rewards` table. Two apps/order reads needed two fields the
-- canonical voucher_templates didn't carry:
--   • lib/loyalty/points.ts deductLoyaltyPoints — the auto_issue gate
--     (auto-issue rewards must be consumed via a voucher, never self-
--     redeemed) + reward_type (log line).
--   • lib/loyalty/welcome.ts ensureNewMemberRewards — filters
--     reward_type='new_member' AND auto_issue=true.
-- voucher_templates had neither column and nothing encoded the taxonomy
-- (reward_kind_id all-NULL, scope only everything/categories), so a
-- faithful migration required encoding them here.
--
-- Additive + backfill only — NO drops. The `rewards` table stays as the
-- live source for apps/loyalty (Phase 4, deferred) until its own
-- migration; this only mirrors the two fields forward.
--
-- Applied via Supabase apply_migration (manual SQL — never prisma db push,
-- which drops non-Prisma tables). Migration name:
--   add_auto_issue_reward_type_to_voucher_templates

ALTER TABLE voucher_templates
  ADD COLUMN IF NOT EXISTS auto_issue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_type text;

-- Backfill the mirrored templates from their legacy reward row. Only rows
-- with a legacy_reward_id (the 3 catalog mirrors) match; native templates
-- keep the safe defaults (auto_issue=false, reward_type=NULL).
UPDATE voucher_templates vt
SET auto_issue  = r.auto_issue,
    reward_type = r.reward_type
FROM rewards r
WHERE vt.legacy_reward_id = r.id;

-- Post-state (verified): reward-1 Free Drink (auto_issue=false,
-- reward_type=standard), reward-3 RM5 + reward-1776593225967 RM10
-- (auto_issue=false, reward_type=points_shop). 0 rows match
-- reward_type='new_member' AND auto_issue=true, so welcome.ts stays the
-- no-op it already was — behaviour preserved.
