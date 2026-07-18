-- Broadens the data-warehouse custodian's registry entry to the whole data
-- estate (owner directive 2026-07-18: "this agent should be accountable for
-- all the data"). Key stays 'finance_warehouse' — keys are stable
-- identifiers (same rule as COA codes); the agent's identity is continuous,
-- only its mandate grew. Metadata-only update.
--
-- Applied 2026-07-18 via Supabase MCP (apply_migration:
-- agent_registry_warehouse_estate_mandate) in-session.

update agent_registry set
  name = 'Data-warehouse custodian (whole estate)',
  description = 'Accountable for the single source of truth across ALL Celsius data: finance (deepest domain: lenses, close pack, AP integrity), HR, procurement/inventory, ops, marketing/loyalty, reviews/ads, comms, and the agent substrate. Verifies freshness/integrity per domain contract, catches data-map drift, files findings and propose-only cleanups. Runbook: .claude/skills/finance-warehouse/SKILL.md (historical path).',
  updated_at = now()
where key = 'finance_warehouse';
