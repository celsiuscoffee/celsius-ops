-- Applied 2026-07-17 via Supabase MCP (apply_migration:
-- agent_registry_finance_warehouse) on the owner's explicit instruction in
-- session (hard rule 6 satisfied). Safe to re-run (on conflict do nothing).
--
-- Registers the finance data-warehouse custodian (design:
-- docs/design/finance-data-warehouse-agent.md, runbook:
-- .claude/skills/finance-warehouse/SKILL.md) in the agent substrate.
-- Shadow = runs read-only checks and files draft-PR findings; nothing in
-- the runbook mutates money records at any mode. arming_criteria set now so
-- the /agents panel can arm it without a second migration.

insert into agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, kill_switch_note, code_path, arming_criteria)
values
  ('finance_warehouse', 'Finance data-warehouse custodian', 'finance',
   'Verifies freshness/integrity of every canonical finance source (unified_sales, BankStatement/Line, Invoice, fin_* ledger, payroll actuals), reconciles the till-rung vs banked-GL revenue lenses, guards the dead trap tables, catches data-map/contract drift, and files findings as draft PRs + close packs. Read-only on prod; all cleanups propose-only.',
   'shadow', 'scheduled_task', 'weekly Sun night MYT + day-1 close pack (on-demand until run 1 proves useful)', true, 'claude-fable-5',
   'Registry mode is the only switch (fail-safe off via getAgentMode).',
   '.claude/skills/finance-warehouse/SKILL.md',
   'Two clean weekly runs: findings accurate (no false alarms the owner had to correct), check suite green or breaches real, and one useful close pack delivered.')
on conflict (key) do nothing;
