-- Applied 2026-07-05 via Supabase MCP (apply_migration:
-- enable_rls_server_only_public_tables), human in session. Audit trail per
-- docs/database-migrations.md — do not re-run.
--
-- Batch 2 of the 2026-07-05 get_advisors sweep: the 14 remaining
-- RLS-disabled public tables, all verified server-only (no native/browser/
-- client-component anon access — grep of apps/ + packages/; "PendingPop" is
-- Prisma-only, direct connection, RLS-exempt). Deny-all closes the public
-- PostgREST exposure with zero app impact (service-role bypasses RLS).
--
-- Result (re-ran get_advisors after): rls_disabled_in_public 24 -> 0,
-- sensitive_columns_exposed 2 -> 0, security ERRORs 30 -> 4 (the 4 left are
-- SECURITY DEFINER views — separate hardening; the outlets view's write
-- path is already revoked in migration 073).

alter table public."PendingPop" enable row level security;             -- POP token; Prisma-only writer
alter table public.grab_webhook_events enable row level security;
alter table public.grab_reconcile_runs enable row level security;
alter table public.grab_campaigns enable row level security;
alter table public.grab_ads_spend enable row level security;
alter table public.grab_modifier_links enable row level security;
alter table public.ads_budget_change enable row level security;
alter table public.ads_search_term_daily enable row level security;
alter table public.ads_term_exclusion enable row level security;
alter table public.poster_events enable row level security;            -- session_id
alter table public.pos_poster_perf enable row level security;
alter table public.challenge_nudge_assignment enable row level security;
alter table public.product_co_purchase_seed enable row level security;
alter table public.product_round_seed enable row level security;
