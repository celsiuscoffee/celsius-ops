-- Birthday segment for the loops engine. member_brands has 20k+ rows; the old
-- approach (fetch all + filter in JS) silently hit the 1000-row default cap and
-- missed qualifiers. This filters server-side and returns only the matches.
-- "Within N days" via MM-DD string match over the next N+1 days (Feb-29 safe).
-- "Today" uses Asia/Kuala_Lumpur so it aligns with the 9am MYT trigger cron.
CREATE OR REPLACE FUNCTION loyalty_birthday_members(p_brand text, p_within_days int DEFAULT 0)
RETURNS TABLE(member_id text, phone text, member_name text)
LANGUAGE sql STABLE
AS $$
  WITH params AS (SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS today)
  SELECT mb.member_id::text, m.phone::text, COALESCE(m.name, '')::text
  FROM member_brands mb
  JOIN members m ON m.id = mb.member_id
  CROSS JOIN params
  WHERE mb.brand_id = p_brand
    AND COALESCE(m.sms_opt_out, false) = false
    AND m.phone IS NOT NULL AND btrim(m.phone) <> ''
    AND m.birthday IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM generate_series(0, GREATEST(p_within_days, 0)) AS g(d)
      WHERE to_char(m.birthday, 'MM-DD') = to_char(params.today + g.d, 'MM-DD')
    );
$$;
