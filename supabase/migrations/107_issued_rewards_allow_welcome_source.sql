-- Proposed 2026-08-19, applied via Supabase MCP after owner approval
-- (see docs/STATE.md welcome-voucher entries). Audit trail per
-- docs/database-migrations.md - do not re-run.
--
-- The welcome-voucher rollout (PR #1155/#1161) issues wallet vouchers with
-- source_type='welcome' — the value the app-only redemption gates key on
-- (resolveOrderReward refuses it on the web channel, the POS redeem route
-- refuses it at the till). But issued_rewards has a CHECK constraint
-- enumerating allowed source_type values, and 'welcome' was never added,
-- so every issuance insert failed with
--   issued_rewards_source_type_check violation
-- (caught live 2026-08-19 during the post-fix E2E test: after() now runs
-- the issuance, the INSERT itself was refused). Widen the constraint to
-- include 'welcome'.

ALTER TABLE public.issued_rewards
  DROP CONSTRAINT issued_rewards_source_type_check;

ALTER TABLE public.issued_rewards
  ADD CONSTRAINT issued_rewards_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'mission'::text,
    'mystery'::text,
    'birthday'::text,
    'referral'::text,
    'milestone'::text,
    'manual'::text,
    'points_redemption'::text,
    'campaign'::text,
    'welcome'::text
  ]));
