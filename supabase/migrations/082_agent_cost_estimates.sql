-- Applied 2026-07-15 via Supabase MCP (apply_migration: agent_cost_estimates),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run
-- the ALTERs are idempotent; the backfill UPDATEs are safe to re-run.
--
-- Cost estimation for the agent registry. Stores per-run TOKEN estimates and a
-- run cadence on each agent; dollar figures are computed live from
-- lib/agents/pricing.ts (never persisted here, so a price change can't leave
-- stale numbers). The /agents panel shows expected $/run and $/month next to
-- the actual 30-day spend rolled up from agent_actions.cost_usd, so estimates
-- get corrected by reality over time.
--
-- Non-LLM (rules) agents keep NULL token estimates and read as $0 - their cost
-- is compute/DB only. LLM agents that run MANY model calls per invocation
-- (e.g. reviews_auto_reply replies to up to 120 reviews) carry a whole-run
-- aggregate estimate; these are deliberately rough and labelled "est" in the UI.

alter table agent_registry add column if not exists est_input_tokens int;
alter table agent_registry add column if not exists est_output_tokens int;
alter table agent_registry add column if not exists est_cache_read_tokens int;
alter table agent_registry add column if not exists est_runs_per_day numeric(8,3);

-- Backfill: per-run token estimates + cadence for the LLM agents. Rough
-- first-pass numbers; the ledger's actual 30-day cost supersedes them on the panel.
update agent_registry set est_input_tokens = 8000,  est_output_tokens = 1200, est_runs_per_day = 4     where key = 'celsius_overview';
update agent_registry set est_input_tokens = 6000,  est_output_tokens = 1600, est_runs_per_day = 1     where key = 'reviews_auto_reply';
update agent_registry set est_input_tokens = 1500,  est_output_tokens = 400,  est_runs_per_day = 0.3   where key = 'reviews_negative_drafts';
update agent_registry set est_input_tokens = 2500,  est_output_tokens = 700,  est_cache_read_tokens = 4000, est_runs_per_day = 8 where key = 'finance_ap_agent';
update agent_registry set est_input_tokens = 3000,  est_output_tokens = 500,  est_cache_read_tokens = 4000, est_runs_per_day = 6 where key = 'finance_ap_match_apply';
update agent_registry set est_input_tokens = 5000,  est_output_tokens = 1500, est_runs_per_day = 0.5   where key = 'hr_schedule_generator';
-- Friday scheduled loops run on the owner's Claude Code subscription, not the
-- API - leave token estimates NULL so they don't inflate the API cost total.
-- Procurement LLM agents are OFF; when armed, estimate per-message here.
