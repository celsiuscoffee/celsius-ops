-- 2026-09-25 QA sweep, item "9 RLS-disabled public tables" (also Supabase
-- get_advisors: rls_disabled_in_public). Same deny-all pattern as 074/075:
-- enabling RLS with no policies blocks the anon/authenticated PostgREST path
-- while the service-role key and Prisma's direct connection bypass RLS, so
-- application behaviour is unchanged.
--
-- All nine verified server-only on 2026-09-26 (grep of apps/ + packages/ +
-- tools/, incl. pickup-native / pos-native / staff-native):
--   SystemReport                  Prisma only (ops-intake, telegram/whatsapp webhooks)
--   ads_campaign_creative         Prisma only (lib/ads/sync-ad-creative.ts upsert)
--   consignment_sales             Prisma $queryRaw only (unified-sales, cash-in-recon,
--                                 settlement-forecast, labour-gate, organic-revenue)
--   mission_order_applications    apps/order loyalty/v2.ts via getSupabaseAdmin (service role)
--   celebration_overlap_removed_20260831, member_brands_ghost_archive_20260803,
--   members_ghost_archive_20260803, poster_state_before_merdeka_20260831,
--   splash_posters_merdeka_restore_20260830
--                                 one-off backup snapshots taken during data
--                                 fixes; no code references at all. The two
--                                 members_* archives hold member PII (phone,
--                                 name) and were readable through the anon key.
--
-- NOT applied to production yet — owner applies via Supabase MCP / SQL editor
-- (hard rule 6 workflow; see KNOWN_UNAPPLIED.json). Idempotent: re-running is a
-- no-op.

alter table public."SystemReport" enable row level security;
alter table public.ads_campaign_creative enable row level security;
alter table public.consignment_sales enable row level security;
alter table public.mission_order_applications enable row level security;
alter table public.celebration_overlap_removed_20260831 enable row level security;
alter table public.member_brands_ghost_archive_20260803 enable row level security;
alter table public.members_ghost_archive_20260803 enable row level security;
alter table public.poster_state_before_merdeka_20260831 enable row level security;
alter table public.splash_posters_merdeka_restore_20260830 enable row level security;
