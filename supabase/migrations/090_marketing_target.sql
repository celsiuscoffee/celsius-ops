-- Owner's standing SMS-marketing target (set 2026-07-19): RM10k/month
-- incremental margin at >=4x blended ROI. Read by the Monday Telegram
-- loops-weekly-report. The 4x is a PORTFOLIO health line, not a per-loop kill
-- bar (loops die only when they can't cover themselves). Tune here, no deploy.
INSERT INTO app_settings (key, value)
VALUES ('marketing_target', '{"margin_rm_month": 10000, "min_roi": 4}'::jsonb)
ON CONFLICT (key) DO NOTHING;
