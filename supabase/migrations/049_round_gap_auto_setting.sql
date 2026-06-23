-- Kill-switch for the round-gap auto-run (runRoundGapDaily). Default ON; set to
-- 'false' to pause the daily 100/SMS reactivation drip without a redeploy.
-- Idempotent data migration (app_settings is key/value).
UPDATE app_settings SET value='true' WHERE key='round_gap_auto_enabled';
INSERT INTO app_settings(key, value)
  SELECT 'round_gap_auto_enabled','true'
  WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key='round_gap_auto_enabled');
