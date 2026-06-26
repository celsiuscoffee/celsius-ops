-- Global cross-loop frequency cap. Per-loop cooldowns don't see each other, so a
-- member could get winback + round-gap + reward-expiring + ... in one week.
-- sendRound calls loyalty_capped_phones() and skips anyone already at the cap.
-- Tunable via app_settings.marketing_weekly_cap (default 2 per 7 days).
CREATE OR REPLACE FUNCTION loyalty_capped_phones(p_cap int DEFAULT 2, p_days int DEFAULT 7)
RETURNS TABLE(phone text) LANGUAGE sql STABLE AS $$
  SELECT la.phone
  FROM loop_assignments la
  JOIN loop_rounds lr ON lr.id = la.round_id
  WHERE la.sms_status = 'sent'
    AND la.phone IS NOT NULL
    AND lr.sent_at >= now() - (p_days || ' days')::interval
  GROUP BY la.phone
  HAVING count(*) >= p_cap;
$$;

-- default cap setting (idempotent)
UPDATE app_settings SET value='2'::jsonb WHERE key='marketing_weekly_cap';
INSERT INTO app_settings(key, value)
  SELECT 'marketing_weekly_cap','2'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key='marketing_weekly_cap');
