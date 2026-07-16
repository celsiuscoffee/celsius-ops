-- 083_ads_autopilot_registry.sql
-- Registers the ads spend autopilot in the agent substrate (see 080/081).
--
-- Owner directive 2026-07-16 (chat, Ammar): "no need human approve. what i
-- need is for you to cut the spending lowest possible without reducing the
-- till revenue... follow your math anchor but do it backwards, from
-- 100% -> lowest, not from zero ads -> highest."
--
-- Armed from day one on that directive. The registry mode is the kill switch:
-- set to 'shadow' or 'off' in Settings > System > AI Agents to stop it.

insert into agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model,
   arming_criteria, kill_switch_note, code_path)
values
  ('ads_autopilot', 'Ads spend autopilot', 'marketing',
   'Weekly closed-loop Google Ads controller: steps each Smart campaign''s daily budget down 8-12% (>=14d observation between changes, max 2 campaigns/run, hard floor RM20/day) and auto-excludes useless search terms (own brand + non-cafe food intent; competitor brands and ambiguous terms are never auto-excluded). Guard: last-14d till revenue vs the labour-gate forecast, fleet-median-adjusted; a breach after a recent cut rolls the budget back one step and holds that campaign 56 days. All changes ledgered in ads_budget_change / ads_term_exclusion as decided_by=ads-autopilot.',
   'armed', 'cron', 'inside cron/ads-daily, Mondays (UTC)', false, null,
   'Owner directive 2026-07-16: minimize spend subject to till revenue not falling. Armed with: per-campaign revenue guard (raw <0.95 or fleet-adj <0.97 = breach -> rollback), no action without a guard signal, step cap 12%, floor RM20/day, exclusion caps (RM2 min spend, 15/campaign/run), human "rejected" ledger rows permanently respected.',
   'Registry mode is the only switch (fail-safe: missing row = off). Floor tunable via ADS_AUTOPILOT_FLOOR_MYR.',
   'apps/backoffice/src/lib/ads/autopilot.ts')
on conflict (key) do nothing;
