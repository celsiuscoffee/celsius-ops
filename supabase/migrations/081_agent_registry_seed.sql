-- Applied 2026-07-15 via Supabase MCP (apply_migration: agent_registry_seed),
-- human in session, together with 080 and BEFORE the backoffice deploy that
-- wires crons to the registry. Audit trail per docs/database-migrations.md —
-- do not re-run (on conflict do nothing makes re-runs harmless anyway).
--
-- Seeds agent_registry with the fleet as surveyed 2026-07-15. Modes reflect
-- CURRENT production behaviour, not aspiration:
--   armed  = acts autonomously today
--   shadow = runs but only proposes/logs (human decides, or propose-only loop)
--   off    = built but disabled behind a flag
-- arming_criteria is deliberately left NULL where none was ever written —
-- the /agents panel surfaces that as debt, and the API refuses to arm
-- anything until criteria are set. kill_switch_note records where the legacy
-- flag lives until the reader migrates to getAgentMode().

insert into agent_registry
  (key, name, domain, description, mode, kind, trigger_detail, uses_llm, model, kill_switch_note, code_path)
values
  -- Finance (the "no bookkeeper" loop)
  ('finance_ap_agent', 'AP invoice agent', 'finance',
   'Parses supplier bills (vision), categorizes to COA, auto-posts journal when parse+categorize confidence >= 0.85; below threshold goes to fin_exceptions.',
   'armed', 'cron', 'upload + bukku-feed-sync 0 */6 * * *', true, 'claude-sonnet-4-6',
   'No env kill switch today; autonomy bounded by AUTO_POST_THRESHOLD=0.85. Registry mode is now the switch (fail-open armed).',
   'apps/backoffice/src/lib/finance/agents/ap.ts'),
  ('finance_ap_match_apply', 'AP match auto-clear', 'finance',
   'Auto-marks invoices paid, links bank lines for high-confidence matches (rules + LLM verifier), auto-creates wage payment slips.',
   'armed', 'cron', '0 21 * * *', true, 'claude-haiku-4-5',
   'No env kill switch today. Registry mode is now the switch (fail-open armed).',
   'apps/backoffice/src/app/api/cron/ap-match-apply/route.ts'),
  ('finance_gl_post', 'GL auto-post', 'finance',
   'Posts classified bank lines into double-entry GL journals, commit true, 4000 lines/run.',
   'armed', 'cron', 'daily', false, null,
   'No env kill switch today. Registry mode is now the switch (fail-open armed).',
   'apps/backoffice/src/app/api/cron/gl-post/route.ts'),
  ('finance_eod', 'POS EOD -> AR journals', 'finance',
   'Ingests yesterday''s POS EOD across outlets and auto-posts AR journals. Idempotent.',
   'armed', 'cron', '0 20 * * *', false, null, null,
   'apps/backoffice/src/app/api/cron/finance-eod/route.ts'),

  -- Reviews / GBP
  ('reviews_auto_reply', 'Reviews auto-reply (positive)', 'reviews',
   'Generates brand-voice replies to 4-5 star Google reviews and posts them to GBP (caps 25/outlet, 120/run). Haiku pass mines praise for fixable ops points.',
   'armed', 'cron', '0 4 * * *', true, 'claude-sonnet-4-6',
   'Improvement-flag sub-feature: REVIEWS_IMPROVEMENT_FLAGS_ENABLED (env).',
   'apps/backoffice/src/app/api/cron/reviews-auto-reply/route.ts'),
  ('reviews_negative_drafts', 'Negative-review draft generator', 'reviews',
   'Drafts suggested replies for 1-3 star reviews into ReviewReplyDraft; nothing posts until a human approves via the decide route.',
   'shadow', 'cron', 'board sync', true, 'claude-sonnet-4-6', null,
   'apps/backoffice/src/lib/reviews/sync-negatives.ts'),
  ('reviews_daily_snapshot', 'Reviews rank snapshot -> Telegram', 'reviews',
   'Snapshots each outlet''s Google review rank + competitor counts and posts to Telegram. Self-heals gbpLocationName nightly.',
   'armed', 'cron', '0 6 * * *', false, null, null,
   'apps/backoffice/src/app/api/cron/reviews-daily-snapshot/route.ts'),

  -- Marketing / loyalty
  ('sms_lifecycle_loops', 'SMS lifecycle loops', 'marketing',
   'Auto-triggered winback/welcome/birthday/reward-expiring/beans-idle loops: issues vouchers and sends real SMS or push to newly-qualifying members.',
   'armed', 'cron', 'loops-trigger 0 1 * * * + loops-send */15', false, null,
   'PDPA sms_opt_out + app_settings.marketing_weekly_cap (default 2/7d) + per-loop cooldowns. No master flag.',
   'apps/backoffice/src/lib/loyalty/loop-engine.ts'),
  ('round_gap_loop', 'Round-gap promo loop', 'marketing',
   'Daily: auto-prepares and sends capped per-segment promo SMS to fill weak day-parts, auto-creates and retires POS promos after measurement.',
   'armed', 'cron', 'daily via loops-trigger', false, null,
   'app_settings.round_gap_auto_enabled = false pauses it.',
   'apps/backoffice/src/lib/loyalty/loop-engine.ts'),
  ('campaigns_auto', 'Legacy AUTO campaigns (inactive/birthday SMS)', 'marketing',
   'Sends SMS for admin-created campaigns tagged [AUTO:...]. MAX_PER_RUN=500, gateway balance check, dedup via sms_logs.',
   'armed', 'cron', '0 3 * * *', false, null, 'Per-campaign is_active + date window.',
   'apps/backoffice/src/app/api/cron/campaigns-auto/route.ts'),
  ('order_loyalty_pushes', 'Order-app loyalty pushes', 'loyalty',
   'Push notifications + birthday voucher drops + voucher-expiry sweeps (birthday, reward-expiring, tier-at-risk, sitting-on-beans, miss-you).',
   'armed', 'cron', 'order app crons', false, null,
   'Per-campaign on/off + frequency cap + quiet hours in notification_campaigns.',
   'apps/order/src/app/api/cron/loyalty-pushes/route.ts'),
  ('friday_marketing_loop', 'Friday marketing brief loop', 'marketing',
   'Weekly propose-only campaign briefs (diagnose weak rounds, draft zero-margin moves, guardrail checks). Runs as a Claude scheduled task on the owner''s machine; approval + execution happen in follow-ups.',
   'shadow', 'scheduled_task', 'Fri 09:03 MYT', true, 'claude-fable-5', null,
   '~/.claude/scheduled-tasks/celsius-marketing-loop/SKILL.md'),
  ('loyalty_pool_tuner', 'Loyalty pool tuner', 'loyalty',
   'Weekly propose-only mission-pool + mystery-pool changes for approval.',
   'shadow', 'scheduled_task', 'Fri 09:30 MYT', true, 'claude-fable-5', null,
   '~/.claude/scheduled-tasks/celsius-loyalty-pool-tuner/SKILL.md'),

  -- Procurement (built, gated off)
  ('procurement_supplier_chat', 'Supplier chat agent', 'procurement',
   'Reads inbound supplier WhatsApp, replies in their language, edits open POs, captures invoices as drafts. Escalates substitutions/cancellations/payments/complaints.',
   'off', 'webhook', 'WhatsApp webhook + procurement-exec 0 1 * * *', true, 'claude-sonnet-4-6',
   'PROCUREMENT_AGENT_ENABLED (env, master) + per-supplier automationMode OFF|ASSIST|AUTO + PROCUREMENT_WHATSAPP_ENABLED.',
   'apps/backoffice/src/lib/inventory/agents/supplier-chat-agent.ts'),
  ('procurement_verifier', 'Procurement decision verifier', 'procurement',
   'Independent LLM judge grading each supplier-chat decision (pass/concern/fail). Flags only; never edits a PO or messages a supplier.',
   'off', 'manual', 'agent-qa page', true, 'claude-sonnet-4-6',
   'PROCUREMENT_VERIFIER_ENABLED (env).',
   'apps/backoffice/src/lib/inventory/agents/verifier-run.ts'),
  ('procurement_pop_verifier', 'POP match verifier', 'procurement',
   'Rescues unmatched proof-of-payment receipts and judges duplicates. PAID write requires AUTOPAY flag AND verdict=pay AND conf>=0.9 AND code re-match AND payee corroboration.',
   'off', 'webhook', 'Telegram POP matcher dead-ends', true, 'claude-sonnet-4-6',
   'PROCUREMENT_POP_VERIFIER_ENABLED + PROCUREMENT_POP_VERIFIER_AUTOPAY (env).',
   'apps/backoffice/src/lib/inventory/agents/pop-verifier-run.ts'),

  -- HR / people
  ('hr_schedule_generator', 'AI roster generator', 'hr',
   'LLM proposes PT hours against demand curve/budget; hard labour-law validation in code; PT slots land as pt_suggestion for manager confirmation.',
   'shadow', 'manual', 'generate button', true, 'claude-sonnet-4-6', null,
   'apps/backoffice/src/lib/hr/agents/schedule-generator.ts'),
  ('hr_attendance_auto_close', 'Attendance auto-close', 'hr',
   'Auto-closes open attendance logs at rostered shift end (missed clock-out): pays regular hours, OT=0, auto-resolves approved+excused.',
   'armed', 'cron', '*/15 * * * *', false, null,
   'No flag today. Registry mode is now the switch (fail-open armed).',
   'apps/backoffice/src/app/api/cron/attendance-auto-close/route.ts'),
  ('hr_deactivate_resigned', 'Deactivate resigned staff', 'hr',
   'Flips User.status to DEACTIVATED once HR end_date passes (revokes app access).',
   'armed', 'cron', '5 16 * * *', false, null, null,
   'apps/backoffice/src/app/api/cron/deactivate-resigned/route.ts'),

  -- Ops
  ('celsius_overview', 'Owner briefing agent', 'ops',
   'Reads a 7-day business snapshot 4x daily and decides what is worth interrupting the owner about on Telegram. Silent runs are normal.',
   'armed', 'cron', '0 1,5,9,13 * * *', true, 'claude-sonnet-4-6', null,
   'apps/backoffice/src/lib/ai-agent/celsius-overview.ts'),
  ('ops_nudges', 'Ops nudges (WhatsApp)', 'ops',
   'DMs staff/managers: bad-review recovery, missed clock-in, overdue stock counts/audits/checklists, unpublished roster, store-not-open.',
   'armed', 'cron', 'ops-nudge-* every 5-30 min', false, null,
   'OPS_NUDGES_MODE env (off|shadow|armed, default armed); NOCLOCKIN/RESTOCK sub-gates default false.',
   'apps/backoffice/src/lib/ops-nudges.ts'),
  ('ops_pulse', 'Ops Pulse KPI pager', 'ops',
   'Real-time + daily KPI detectors; when armed, DMs manager on WhatsApp and escalates to owner past 90-min SLA.',
   'shadow', 'cron', 'every 5 min + daily', false, null,
   'OPS_PULSE_MODE / OPS_PULSE_DAILY_MODE env (default shadow).',
   'apps/backoffice/src/lib/ops-pulse'),
  ('ops_scoreboard', 'Weekly 4DX scoreboard', 'ops',
   'Weekly per-outlet performance boards to WhatsApp when armed.',
   'shadow', 'cron', '0 1 * * 1', false, null, 'OPS_SCOREBOARD_MODE env (default shadow).',
   'apps/backoffice/src/app/api/cron/ops-scoreboard/route.ts'),
  ('labour_variance', 'Monday labour variance digest', 'ops',
   'Weekly labour cost variance report; flip to armed after one sane Monday (per STATE.md).',
   'shadow', 'cron', '30 1 * * 1', false, null, 'LABOUR_VARIANCE_MODE env (default shadow).',
   'apps/backoffice/src/app/api/cron/labour-variance/route.ts'),

  -- POS / merchandising / inventory engines
  ('pos_poster_autopilot', 'POS poster autopilot', 'pos',
   'Scores splash posters by margin/AOV lift and auto-flips active/sort_order on POS customer display + app home. Switchback A/B by day parity.',
   'off', 'cron', '0 23 * * *', false, null,
   'app_settings.pos_poster_autopilot_enabled (default false).',
   'apps/backoffice/src/lib/pos/poster-autopilot.ts'),
  ('pos_pairing_tuner', 'Upsell pairing weight tuner', 'pos',
   'Nightly SQL refresh of day-part popularity + co-purchase signals feeding POS "Pair with a Bite" suggestions.',
   'armed', 'pg_cron', '20 16 * * *', false, null, null,
   'apps/backoffice/supabase/migrations/017_pos_pairing_signals_nightly.sql'),
  ('par_levels_recalc', 'Par levels recalc', 'pos',
   'Weekly overwrite of every outlet''s par/reorder/max levels from last-30-day sales.',
   'armed', 'cron', '7 19 * * 0', false, null, null,
   'apps/backoffice/src/app/api/cron/par-levels-recalc/route.ts'),
  ('consumption_engine', 'Consumption engine', 'pos',
   'Turns sales x recipe BOM into negative stock adjustments (the missing consumption ledger). Currently computes + reports, writes nothing.',
   'shadow', 'cron', '25 19 * * *', false, null,
   'CONSUMPTION_ENGINE_ENABLED env + OWNER system user must exist.',
   'apps/backoffice/src/app/api/cron/consumption-post/route.ts'),
  ('stock_count_auto_approve', 'Stock count auto-approve', 'ops',
   'Zero-variance counts auto-approve to REVIEWED on finalize, skipping the manager queue.',
   'armed', 'webhook', 'on finalize', false, null, null,
   'apps/staff/src/app/api/stock-checks/[id]/finalize/route.ts')
on conflict (key) do nothing;
