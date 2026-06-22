-- Post-window cleanup for a round-gap round: deactivate its auto-created promo
-- and strip the campaign tag from members, so the offer can't linger past the
-- measured window. Called by measureRound when a round_gap round is measured.
CREATE OR REPLACE FUNCTION loyalty_round_gap_cleanup(p_promo_id text, p_tag text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_promo_id IS NOT NULL THEN
    UPDATE promotions SET is_active = false WHERE id = p_promo_id;
  END IF;
  IF p_tag IS NOT NULL THEN
    UPDATE members SET tags = array_remove(tags, p_tag) WHERE p_tag = ANY(tags);
  END IF;
END;
$$;
