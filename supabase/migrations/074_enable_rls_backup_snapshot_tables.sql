-- Applied 2026-07-05 via Supabase MCP (apply_migration:
-- enable_rls_on_backup_snapshot_tables). Saved for the audit trail per
-- docs/database-migrations.md — do not re-run.
--
-- From the 2026-07-05 get_advisors security sweep: 24 public tables had RLS
-- disabled (anon-reachable via PostgREST). This migration closes the 10
-- unambiguously-safe ones — dated snapshot / soft-delete copies nothing
-- reads through the anon key. Deny-all (RLS on, no policy); service-role
-- bypasses so ops/exports are unaffected. Drop candidates once retention
-- passes (separate human-run cleanup).
--
-- The remaining 14 (PendingPop, grab_*, ads_*, poster_events, pos_poster_perf,
-- challenge_nudge_assignment, product_*_seed) touch payments/POS/grab and
-- need per-table verification — see docs/rls-access-map-2026-07-05.md
-- "Live advisor snapshot"; NOT changed here (hard rule 6).

alter table public.pos_orders_backup_20260606 enable row level security;
alter table public.pos_order_items_backup_20260606 enable row level security;
alter table public.pos_order_payments_backup_20260606 enable row level security;
alter table public.pos_shifts_backup_20260606 enable row level security;
alter table public.pos_pair_events_backup_20260606 enable row level security;
alter table public.point_txn_deleted_20260606 enable row level security;
alter table public.point_txn_deleted_20260615 enable row level security;
alter table public.member_brands_adj_20260606 enable row level security;
alter table public.member_brands_adj_20260615 enable row level security;
alter table public.loop_assignments_quarantine_20260624 enable row level security;
