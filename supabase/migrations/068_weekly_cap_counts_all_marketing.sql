-- Close the weekly-cap blind spot: loyalty_capped_phones() only counted LOOP
-- sends (loop_assignments), so campaigns-auto and manual blasts — which log to
-- sms_logs, not loop_assignments — never counted toward the "max N marketing
-- messages per member per week" cap. A member could take the full loop cap AND
-- a blast in the same week. Count both sources per phone before capping.
--
-- No double-count: loop sends never write sms_logs (sendSMS itself doesn't
-- log; sms_logs writers are the campaigns-auto cron + the manual blast route).
-- OTP/transactional messages don't land in sms_logs either, so this stays a
-- MARKETING cap. Same signature — sendRound's caller needs no change.
CREATE OR REPLACE FUNCTION loyalty_capped_phones(p_cap int DEFAULT 2, p_days int DEFAULT 7)
RETURNS TABLE(phone text) LANGUAGE sql STABLE AS $$
  SELECT phone FROM (
    SELECT la.phone
    FROM loop_assignments la
    JOIN loop_rounds lr ON lr.id = la.round_id
    WHERE la.sms_status = 'sent'
      AND la.phone IS NOT NULL
      AND lr.sent_at >= now() - (p_days || ' days')::interval
    UNION ALL
    SELECT sl.phone
    FROM sms_logs sl
    WHERE sl.status IN ('sent', 'delivered')
      AND sl.phone IS NOT NULL
      AND sl.created_at >= now() - (p_days || ' days')::interval
  ) sends
  GROUP BY phone
  HAVING count(*) >= p_cap;
$$;

-- The union scans sms_logs by recency on every send; index the hot path.
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_created ON sms_logs (phone, created_at);
