-- Deterministic ordering on the set-returning loop RPCs so callers can page
-- past PostgREST's 1000-row cap safely. (Applied live 2026-08-19.)
-- Without a total order, page 2 of an unordered result can repeat or skip
-- rows -- which for loyalty_capped_phones means silently dropping members
-- from the anti-spam suppress list (the #533 failure mode all over again).
CREATE OR REPLACE FUNCTION loyalty_capped_phones(p_cap int DEFAULT 2, p_days int DEFAULT 7)
RETURNS TABLE(phone text) LANGUAGE sql STABLE AS $func$
  SELECT la.phone
  FROM loop_assignments la
  JOIN loop_rounds lr ON lr.id = la.round_id
  WHERE la.sms_status = 'sent' AND la.phone IS NOT NULL
    AND lr.sent_at >= now() - (p_days || ' days')::interval
  GROUP BY la.phone
  HAVING count(*) >= p_cap
  ORDER BY la.phone;
$func$;

CREATE OR REPLACE FUNCTION loyalty_birthday_members(p_brand text, p_within_days int DEFAULT 0)
RETURNS TABLE(member_id text, phone text, member_name text) LANGUAGE sql STABLE AS $func$
  SELECT m.id::text, m.phone::text, coalesce(m.name,'')::text
  FROM members m
  JOIN member_brands mb ON mb.member_id = m.id AND mb.brand_id = p_brand
  WHERE m.birthday IS NOT NULL
    AND coalesce(m.sms_opt_out,false) = false
    AND m.phone IS NOT NULL AND btrim(m.phone) <> ''
    AND (
      to_char(m.birthday, 'MM-DD') = to_char((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, 'MM-DD')
      OR (p_within_days > 0 AND to_char(m.birthday, 'MM-DD') = ANY (
            SELECT to_char(((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + i), 'MM-DD')
            FROM generate_series(1, p_within_days) i))
    )
  ORDER BY m.id;
$func$;
