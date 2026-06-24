-- Deterministic holdout for round-gap (parity with the TS engine fix in
-- loop-engine.ts). The v5 prepare RPC split the holdout with a per-round
-- random() (see 048), which let a member be treated in one round and held out
-- in another — the same contamination that made winback's holdout convert
-- HIGHER than treatment. Here the holdout becomes a stable function of
-- (loop, member): a member is always control or always treated for round_gap.
--
-- loyalty_holdout_bucket reproduces the engine's djb2 EXACTLY (h*33 + c, mod
-- 2^32, then mod 100), keyed on 'round_gap:'||member_id — so a member assigned
-- via prepareRound and via this RPC lands on the SAME side. Verified against the
-- JS reference for several ids (m-0→28, abc-123→79, a uuid→45, x→74).

CREATE OR REPLACE FUNCTION loyalty_holdout_bucket(p_loop text, p_member text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := p_loop || ':' || p_member; h bigint := 5381; i int;
BEGIN
  FOR i IN 1..length(s) LOOP
    -- (h<<5)+h+c ≡ h*33 + c (mod 2^32); JS's signed-shift washes out under the mask
    h := ((h * 33) + ascii(substr(s, i, 1))) % 4294967296;
  END LOOP;
  RETURN (h % 100)::int;
END; $$;

-- Recreate the round-gap prepare with the deterministic holdout. Body identical
-- to 048 except the holdout decision on the segment (was: random() < pct).
CREATE OR REPLACE FUNCTION loyalty_round_gap_prepare(
  p_outlet text, p_round_start int, p_round_end int,
  p_round_name text, p_arms jsonb,
  p_free_category text DEFAULT 'classic',
  p_holdout_pct int DEFAULT 10, p_window_days int DEFAULT 7, p_limit int DEFAULT 100
)
RETURNS TABLE(round_id text, treated int, holdout int, promos jsonb)
LANGUAGE plpgsql AS $$
DECLARE
  v_round_id text := 'lr-rg-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_round_no int; v_outlet_ids text[]; v_treated int; v_holdout int;
  v_date text := to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYYMMDD');
  v_arm jsonb; v_armkey text; v_armtag text; v_armpromo text; v_armmin numeric; v_n int;
  v_promos jsonb := '[]'::jsonb;
BEGIN
  v_outlet_ids := CASE p_outlet
    WHEN 'conezion' THEN ARRAY['conezion','outlet-con']
    WHEN 'shah-alam' THEN ARRAY['shah-alam','outlet-sa']
    WHEN 'tamarind' THEN ARRAY['tamarind','outlet-tam']
    ELSE ARRAY[p_outlet] END;
  CREATE TEMP TABLE _seg ON COMMIT DROP AS
    SELECT member_id, phone, member_name,
      -- DETERMINISTIC holdout: stable per (round_gap, member), never a per-round
      -- random slice, so the control can't fill with already-messaged members.
      CASE WHEN loyalty_holdout_bucket('round_gap', member_id) < p_holdout_pct
           THEN 'holdout' ELSE 'rg_'||source END AS arm
    FROM (
      SELECT member_id, phone, member_name, source
      FROM loyalty_round_gap_segment(p_outlet, p_round_start, p_round_end)
      ORDER BY priority, random()
      LIMIT p_limit
    ) seg;
  SELECT count(*) FILTER (WHERE arm <> 'holdout'), count(*) FILTER (WHERE arm='holdout') INTO v_treated, v_holdout FROM _seg;
  IF v_treated = 0 THEN RETURN QUERY SELECT NULL::text, 0, 0, '[]'::jsonb; RETURN; END IF;

  FOR v_arm IN SELECT * FROM jsonb_array_elements(p_arms) LOOP
    v_armkey := v_arm->>'key';
    SELECT count(*) INTO v_n FROM _seg WHERE arm = v_armkey;
    IF v_n > 0 THEN
      v_armtag := 'rg_'||p_outlet||'_'||replace(v_armkey,'rg_','')||'_'||v_date;
      v_armpromo := 'pr-rg-'||substr(md5(random()::text||clock_timestamp()::text||v_armkey),1,14);
      v_armmin := coalesce(nullif(v_arm->>'min_order','')::numeric, 35);
      INSERT INTO promotions(id, brand_id, name, description, trigger_type, discount_type,
        applicable_categories, min_order_value, eligible_member_tags, outlet_ids,
        time_start, time_end, valid_from, valid_until, is_active, priority, stackable)
      VALUES (v_armpromo, 'brand-celsius', p_round_name||' · '||replace(v_armkey,'rg_',''),
        'Round-gap auto promo', 'auto', 'free_item',
        ARRAY[p_free_category], v_armmin, ARRAY[v_armtag], v_outlet_ids,
        make_time(p_round_start,0,0), make_time(p_round_end,0,0),
        now(), now() + (p_window_days||' days')::interval, true, 60, false);
      UPDATE members m SET tags = (SELECT array(SELECT DISTINCT e FROM unnest(coalesce(m.tags,'{}'::text[]) || ARRAY[v_armtag]) e))
      WHERE m.id IN (SELECT member_id FROM _seg WHERE arm = v_armkey);
      v_promos := v_promos || jsonb_build_object('arm',v_armkey,'tag',v_armtag,'promo_id',v_armpromo,'min_order',v_armmin);
    END IF;
  END LOOP;

  SELECT coalesce(max(round_no),0)+1 INTO v_round_no FROM loop_rounds WHERE loop_key='round_gap';
  INSERT INTO loop_rounds(id, brand_id, loop_key, round_no, segment_label, holdout_pct, arms,
    attribution_window_days, status, created_by, prepared_at, meta)
  VALUES (v_round_id, 'brand-celsius', 'round_gap', v_round_no,
    p_round_name || ' (' || v_treated || ' reachable, ' || p_holdout_pct || '% holdout)', p_holdout_pct,
    p_arms, p_window_days, 'prepared', 'round-gap', now(),
    jsonb_build_object('kind','round_gap','outlet',p_outlet,'round_start',p_round_start,'round_end',p_round_end,'promos',v_promos));
  INSERT INTO loop_assignments(id, round_id, member_id, phone, arm, sms_status, assigned_at)
  SELECT 'la-'||substr(md5(random()::text || clock_timestamp()::text || member_id),1,18), v_round_id, member_id, phone, arm, NULL, now() FROM _seg;
  RETURN QUERY SELECT v_round_id, v_treated, v_holdout, v_promos;
END;
$$;
