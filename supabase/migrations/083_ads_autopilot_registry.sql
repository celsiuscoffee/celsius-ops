-- 083_ads_autopilot_registry.sql
-- Registers the ads spend autopilot in the agent substrate (see 080/081).
-- Applied to prod 2026-07-16 via Supabase MCP (insert, then description/
-- criteria update after the owner widened the objective the same day).
--
-- Owner directives 2026-07-16 (chat, Ammar): "no need human approve. what i
-- need is for you to cut the spending lowest possible without reducing the
-- till revenue... from 100% -> lowest, not from zero ads -> highest", then:
-- "ads spend should be generating cash. source of truth is the till revenue.
-- trimming is just the first step. next is to find the best way to increase
-- cash."
--
-- Armed from day one on that directive. The registry mode is the kill switch:
-- set to 'shadow' or 'off' in Settings > System > AI Agents to stop it.

insert into agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model,
   arming_criteria, kill_switch_note, code_path)
values
  ('ads_autopilot', 'Ads spend autopilot', 'marketing',
   'Weekly closed-loop Google Ads controller searching each Smart campaign''s cash-optimal budget, with till revenue as the only source of truth. DESCENDS 8-12%/step (>=14d observation, max 2 cuts/run, floor RM20/day); a till-revenue guard breach after a recent cut ROLLS BACK one step (+56d hold) — proof the spend was generating cash; after the hold it PROBES UP +15% (28d observation, cap 1.25x baseline), keeping a raise only on detectable till lift and otherwise settling at the proven optimum for 90d. Burden of proof is asymmetric: cuts stand unless the till proves harm, raises revert unless the till proves lift. Also auto-excludes useless search terms (own brand + non-cafe food intent; competitor brands and ambiguous terms are never auto-excluded). All changes ledgered in ads_budget_change / ads_term_exclusion as decided_by=ads-autopilot.',
-- 2026-07-16 (same day, owner-approved): description extended in prod with the
-- PAUSE PROBE (28d full pause of one clearly-inefficient campaign at a time,
-- auto-restore + verdict) and the pre-descent share-of-fleet ANCHOR guard
-- (<0.93 = breach) — see autopilot.ts header for the full state machine.
   'armed', 'cron', 'inside cron/ads-daily, Mondays (UTC)', false, null,
   'Owner directives 2026-07-16: maximize cash (till lift x margin - spend), trim first, then search upward; no per-change approval. Armed with: per-campaign revenue guard (raw <0.95 or fleet-adj <0.97 = breach -> rollback), raises kept only on lift (fleet-adj >=1.02 and raw >=1.0), no action without a guard signal, step caps 12%/15%, floor RM20/day, raise cap 1.25x baseline, exclusion caps (RM2 min spend, 15/campaign/run), human "rejected" ledger rows permanently respected.',
   'Registry mode is the only switch (fail-safe: missing row = off). Floor via ADS_AUTOPILOT_FLOOR_MYR, margin via ADS_GROSS_MARGIN (default 0.6).',
   'apps/backoffice/src/lib/ads/autopilot.ts')
on conflict (key) do nothing;
