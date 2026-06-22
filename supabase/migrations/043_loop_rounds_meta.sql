-- Generic metadata bag for loop rounds — round-gap stashes {outlet, round_start,
-- round_end, promo_id, member_tag} so it can measure the right day-part and clean
-- up its auto-created promo + tags after the window.
ALTER TABLE loop_rounds ADD COLUMN IF NOT EXISTS meta jsonb;
