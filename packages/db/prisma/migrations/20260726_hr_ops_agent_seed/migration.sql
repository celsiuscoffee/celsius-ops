-- HR Ops Agent — registry seed (design: docs/design/hr-ops-agent.md).
-- Data-only insert; no schema change. Mode starts 'off': the webhook code is
-- deployed dark and does nothing until the owner flips this row to 'shadow'
-- from the /agents panel (or SQL). Fail-safe per substrate rules — a NEW
-- agent that cannot prove its mode reads as off.
--
-- Apply: manually via Supabase SQL (hybrid workflow, docs/database-migrations.md).

INSERT INTO agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model,
   arming_criteria, kill_switch_note, code_path)
VALUES (
  'hr_ops_agent',
  'HR Ops Agent (WhatsApp)',
  'hr',
  'Two personas on the business WhatsApp number, routed by sender: ops (owner/HOO/managers file staff-lifecycle changes as shadow proposals via the internal assistant) and staff (own-record self-service reads: shifts, hours, leave, claims; grievances escalate to HQ). Stage 1 writes nothing to HR tables — proposals are applied by a human and diffed to earn arming.',
  'off',
  'realtime',
  'WhatsApp webhook (/api/whatsapp/webhook) — staff-role senders + internal-assistant HR tools',
  true,
  'claude-sonnet-4-6',
  '5 consecutive shadow ops proposals applied without correction; 1 week of clean staff-persona replies (no wrong-person data, no invented facts)',
  'Registry mode only — no env flag. Off = staff messages consumed silently (still shielded from supplier flows), ops HR tools reply "not enabled".',
  'apps/backoffice/src/lib/hr/agent/'
)
ON CONFLICT (key) DO NOTHING;
