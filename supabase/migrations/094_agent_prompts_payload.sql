-- Applied 2026-07-20 via Supabase MCP (apply_migration: agent_prompts_payload),
-- human in session. Audit trail per docs/database-migrations.md - do not re-run.
--
-- Add agent_prompts.payload: opaque data the pulse webhook needs to ACT on an
-- owner's Approve/Reject answer (e.g. {action:'clear_ap_match', match:{...}}).
-- The shared agents package never interprets it; the app's webhook dispatches
-- on it. Used first by the staff pay-and-claim flow: on Approve, the webhook
-- replays the stored AP match and settles the invoice.

alter table agent_prompts add column if not exists payload jsonb;
