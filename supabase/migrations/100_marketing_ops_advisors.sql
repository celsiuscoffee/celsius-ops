-- Register the marketing_strategist and ops_intelligence agents: the second and
-- third deterministic->LLM conversions, both following the procurement_advisor
-- template (deterministic rollup + LLM judgment, advisory only). Neither writes
-- anything, so both ship armed; mode is the kill switch.
--
-- Applied 2026-07-24 via Supabase MCP (apply_migration: marketing_ops_advisors),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.

insert into agent_registry (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, code_path)
values
(
  'marketing_strategist',
  'Marketing strategist',
  'marketing',
  'Reasons over 60 days of POOLED campaign outcomes (individual rounds are too small to read) and recommends which SMS loops to scale, kill, or prove with more volume, plus one test worth running. Advisory: recommends on Telegram, does not change loop config or send anything.',
  'armed',
  'cron',
  'Weekly, Monday 9am MYT via the loops-trigger cron (advisory)',
  true,
  'claude-sonnet-4-6',
  'apps/backoffice/src/lib/marketing/marketing-strategist.ts'
),
(
  'ops_intelligence',
  'Ops intelligence',
  'operations',
  'Reads a week of ops signals (alert volume per outlet AND whether alerts were ever actioned, checklist completion, clock-in gaps, overtime, sales vs trailing) and coaches: which outlet is slipping, what pattern repeats, what to actually do. Advisory: reports on Telegram, changes nothing.',
  'armed',
  'cron',
  'Weekly, Monday 1pm MYT via the celsius-overview cron (advisory)',
  true,
  'claude-sonnet-4-6',
  'apps/backoffice/src/lib/ops/ops-intelligence.ts'
)
on conflict (key) do update set
  name = excluded.name,
  domain = excluded.domain,
  description = excluded.description,
  kind = excluded.kind,
  trigger_detail = excluded.trigger_detail,
  uses_llm = excluded.uses_llm,
  model = excluded.model,
  code_path = excluded.code_path,
  updated_at = now();
