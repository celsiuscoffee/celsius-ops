-- Register the data_analyst agent: the "ask anything" brain behind the pulse
-- Telegram thread. Owner-triggered (not autonomous) and strictly read-only, so
-- it ships armed. Mode is still the kill switch - set to 'off' to disable
-- answering without a deploy.
--
-- Applied 2026-07-23 via Supabase MCP (apply_migration: data_analyst_agent),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.

insert into agent_registry (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, code_path)
values (
  'data_analyst',
  'Data analyst',
  'intelligence',
  'Answers the owner''s plain-English questions on Telegram by writing a read-only SQL query across the live business data (sales, finance, inventory, HR, loyalty, reviews) and explaining the result. Curated golden queries for the common questions, model-authored SQL for the rest.',
  'armed',
  'on_demand',
  'Owner sends any (non-reply) message to the pulse bot',
  true,
  'claude-sonnet-4-6',
  'apps/backoffice/src/lib/agents/data-analyst.ts'
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
