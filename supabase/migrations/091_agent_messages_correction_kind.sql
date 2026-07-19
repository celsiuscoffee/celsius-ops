-- PENDING APPLY - replace this header with the "Applied YYYY-MM-DD via Supabase
-- MCP" audit line per docs/database-migrations.md once applied.
--
-- Add the 'correction' kind to agent_messages: the case the owner specifically
-- wants to see - a verifier finds a problem in another agent's work and tells
-- it what's right (e.g. the Finance verifier rejects a wrong bank-line match,
-- or the Procurement verifier grades a supplier reply as wrong). Distinct from
-- 'learning' (the agent absorbing a human correction) so the "a verifier just
-- taught an agent" moments are filterable on their own.

alter table agent_messages drop constraint if exists agent_messages_kind_check;
alter table agent_messages add constraint agent_messages_kind_check
  check (kind in ('handoff', 'learning', 'logic_change', 'report', 'correction'));

-- The daily digest is folded into the owner-briefing cron's 9pm MYT firing
-- rather than a separate Vercel cron (project is near the 40-cron cap); reflect
-- that on its registry row.
update agent_registry
set trigger_detail = 'daily 9pm MYT (folded into owner-briefing cron)'
where key = 'agent_comms_digest';
