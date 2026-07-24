-- Register the procurement_advisor agent: the LLM judgment layer over the
-- deterministic reorder engine. Advisory only (recommends, does not create POs),
-- so it ships armed; mode is the kill switch.
--
-- Applied 2026-07-24 via Supabase MCP (apply_migration: procurement_advisor_agent),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.

insert into agent_registry (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, code_path)
values (
  'procurement_advisor',
  'Procurement advisor',
  'procurement',
  'Reasons over the day''s reorder candidates (already computed from par levels, on-hand, open POs, and cheapest supplier) and recommends what to order NOW vs hold - watching cash and Celsius''s over-buy problem (COGS ~55% vs 35% target). Advisory: sends the owner a prioritised recommendation on Telegram, does not create or send POs.',
  'armed',
  'cron',
  'Daily 9am MYT via the procurement-loop cron (advisory)',
  true,
  'claude-sonnet-4-6',
  'apps/backoffice/src/lib/procurement/procurement-advisor.ts'
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
