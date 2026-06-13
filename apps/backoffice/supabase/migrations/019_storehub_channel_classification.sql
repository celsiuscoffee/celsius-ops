-- APPLIED to production 2026-06-12 (Supabase migration
-- storehub_channel_classification) + full backfill of all 66,643 rows.
--
-- Materialized channel classification for storehub_sales. The sales
-- dashboards previously shipped the full `raw` JSONB of every archive
-- row (146 MB table) to JS and re-ran fuzzy classification per request.
-- channel_class/is_delivery_qr are now:
--   * written by the importer (storehub-archive.ts) via the canonical
--     JS classifier for new rows
--   * backfilled via the SQL twins below — exact ports of
--     classifyChannel/isDeliveryOrQR (storehub-helpers.ts), verified on
--     a 248-row stratified production sample with 0 mismatches
-- The read path (unified-sales.ts) uses the columns and only falls back
-- to `raw` for unclassified rows. To close any ingest gap, re-run:
--   UPDATE storehub_sales
--   SET channel_class = classify_storehub_channel(raw),
--       is_delivery_qr = is_storehub_delivery_qr(raw)
--   WHERE channel_class IS NULL;

ALTER TABLE storehub_sales
  ADD COLUMN IF NOT EXISTS channel_class text,
  ADD COLUMN IF NOT EXISTS is_delivery_qr boolean;

CREATE OR REPLACE FUNCTION storehub_hints(raw jsonb, include_tags boolean)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  hints text[] := '{}';
  k text; v jsonb;
BEGIN
  IF coalesce(raw->>'channel','') <> '' THEN hints := hints || lower(btrim(raw->>'channel')); END IF;
  IF coalesce(raw->>'remarks','') <> '' THEN hints := hints || lower(btrim(raw->>'remarks')); END IF;
  IF coalesce(raw->>'orderType','') <> '' THEN hints := hints || lower(btrim(raw->>'orderType')); END IF;
  IF include_tags AND jsonb_typeof(raw->'tags') = 'array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(raw->'tags') LOOP
      IF jsonb_typeof(v) = 'string' THEN hints := hints || lower(btrim(v #>> '{}')); END IF;
    END LOOP;
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(raw) LOOP
    CONTINUE WHEN k IN ('items','channel','remarks','orderType','tags');
    IF jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') < 50 THEN
      hints := hints || lower(btrim(v #>> '{}'));
    END IF;
  END LOOP;
  RETURN hints;
END $$;

CREATE OR REPLACE FUNCTION classify_storehub_channel(raw jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  hints text[]; combined text; h text;
BEGIN
  IF raw IS NULL THEN RETURN 'dine_in'; END IF;
  hints := storehub_hints(raw, true);
  combined := array_to_string(hints, ' ');
  IF combined ~ '\y(grab|grabfood|foodpanda|shopee|shopeefood)\y' THEN RETURN 'delivery'; END IF;
  IF combined ~ '\ydelivery\y' THEN RETURN 'delivery'; END IF;
  IF combined ~ '\y(takeaway|take[\s-]?away|tapau|dabao|bungkus)\y' THEN RETURN 'takeaway'; END IF;
  FOREACH h IN ARRAY hints LOOP
    IF h = 'ta' THEN RETURN 'takeaway'; END IF;
  END LOOP;
  RETURN 'dine_in';
END $$;

CREATE OR REPLACE FUNCTION is_storehub_delivery_qr(raw jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  hints text[]; combined text;
BEGIN
  IF raw IS NULL THEN RETURN false; END IF;
  hints := storehub_hints(raw, false);
  combined := array_to_string(hints, ' ');
  RETURN combined ~ '\y(delivery|grab|grabfood|foodpanda|shopee|shopeefood)\y'
      OR combined ~ '\y(qr[\s_-]?table|qr[\s_-]?order|qrtable)\y'
      OR 'qr' = ANY(hints);
END $$;
