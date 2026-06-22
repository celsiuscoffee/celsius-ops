-- Add a per-run cap (p_limit, default 100) to round-gap prepare so a run sends at
-- most N SMS, taking the highest-priority slice of the segment (skippers first,
-- then tier/points imports). This is what powers the "100/day" reactivation drip
-- over the dormant imported base. Drop old signature first to avoid an overload.
DROP FUNCTION IF EXISTS loyalty_round_gap_prepare(text, int, int, text, text, text, text, numeric, int, int);

CREATE FUNCTION loyalty_round_gap_prepare(
  p_outlet text, p_round_start int, p_round_end int,
  p_round_name text, p_offer_label text, p_message text,
  p_free_category text DEFAULT 'classic', p_min_order numeric DEFAULT 35,
  p_holdout_pct int DEFAULT 10, p_window_days int DEFAULT 7, p_limit int DEFAULT 100
)
RETURNS TABLE(round_id text, treated int, holdout int, promo_id text, member_tag text)
LANGUAGE plpgsql AS $$
DECLARE
  v_tag text := 'rg_' || p_outlet || '_r' || p_round_start || '_' || to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYYMMDD');
  v_round_id text := 'lr-rg-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_promo_id text := 'pr-rg-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_round_no int; v_outlet_ids text[]; v_treated int; v_holdout int;
BEGIN
  v_outlet_ids := CASE p_outlet
    WHEN 'conezion' THEN ARRAY['conezion','outlet-con']
    WHEN 'shah-alam' THEN ARRAY['shah-alam','outlet-sa']
    WHEN 'tamarind' THEN ARRAY['tamarind','outlet-tam']
    ELSE ARRAY[p_outlet] END;
  CREATE TEMP TABLE _seg ON COMMIT DROP AS
    SELECT member_id, phone, member_name,
      CASE WHEN random() < p_holdout_pct::numeric/100 THEN 'holdout' ELSE 'rg' END AS arm
    FROM (
      SELECT member_id, phone, member_name
      FROM loyalty_round_gap_segment(p_outlet, p_round_start, p_round_end)
      ORDER BY priority, random()
      LIMIT p_limit
    ) seg;
  SELECT count(*) FILTER (WHERE arm='rg'), count(*) FILTER (WHERE arm='holdout') INTO v_treated, v_holdout FROM _seg;
  IF v_treated = 0 THEN RETURN QUERY SELECT NULL::text, 0, 0, NULL::text, NULL::text; RETURN; END IF;
  UPDATE members m SET tags = (SELECT array(SELECT DISTINCT e FROM unnest(coalesce(m.tags,'{}'::text[]) || ARRAY[v_tag]) e))
  WHERE m.id IN (SELECT member_id FROM _seg WHERE arm='rg');
  INSERT INTO promotions(id, brand_id, name, description, trigger_type, discount_type,
    applicable_categories, min_order_value, eligible_member_tags, outlet_ids,
    time_start, time_end, valid_from, valid_until, is_active, priority, stackable)
  VALUES (v_promo_id, 'brand-celsius', p_round_name, 'Round-gap auto promo', 'auto', 'free_item',
    ARRAY[p_free_category], p_min_order, ARRAY[v_tag], v_outlet_ids,
    make_time(p_round_start,0,0), make_time(p_round_end,0,0),
    now(), now() + (p_window_days||' days')::interval, true, 60, false);
  SELECT coalesce(max(round_no),0)+1 INTO v_round_no FROM loop_rounds WHERE loop_key='round_gap';
  INSERT INTO loop_rounds(id, brand_id, loop_key, round_no, segment_label, holdout_pct, arms,
    attribution_window_days, status, created_by, prepared_at, meta)
  VALUES (v_round_id, 'brand-celsius', 'round_gap', v_round_no,
    p_round_name || ' (' || v_treated || ' reachable, ' || p_holdout_pct || '% holdout)', p_holdout_pct,
    jsonb_build_array(jsonb_build_object('key','rg','label',p_offer_label,'message',p_message,'voucher_template_id','','promo_id',v_promo_id)),
    p_window_days, 'prepared', 'round-gap', now(),
    jsonb_build_object('kind','round_gap','outlet',p_outlet,'round_start',p_round_start,'round_end',p_round_end,'promo_id',v_promo_id,'member_tag',v_tag));
  INSERT INTO loop_assignments(id, round_id, member_id, phone, arm, sms_status, assigned_at)
  SELECT 'la-'||substr(md5(random()::text || clock_timestamp()::text || member_id),1,18), v_round_id, member_id, phone, arm, NULL, now() FROM _seg;
  RETURN QUERY SELECT v_round_id, v_treated, v_holdout, v_promo_id, v_tag;
END;
$$;
