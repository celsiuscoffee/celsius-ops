-- Close the loop: pausable loops/arms + seed today's two proven losers.
-- app_settings.loops_paused (jsonb object): key = loop key ("beans_idle") or
-- round-gap arm ("round_gap:rg_import"); value = {at, reason, auto?}.
-- The daily auto-run skips paused entries; autoPauseUnderperformers() adds
-- entries itself once pooled evidence shows no lift (never un-pauses — resume
-- is an operator decision: remove the key from this setting).
--
-- Seeded from the 2026-07-12 loop QA (pooled honest measurement, 63 rounds):
--   round_gap:rg_import — 0.32% conversion over 1,249 sends (4 in-gap orders);
--     drags the whole loop to -1.2pp. Skipper arm (+3.4pp) keeps running.
--   beans_idle — +1.0pp vs holdout (27.1% vs 26.1%) after 225 sends and ZERO
--     points redemptions ever; active members who come anyway.

INSERT INTO app_settings (key, value)
VALUES ('loops_paused', jsonb_build_object(
  'round_gap:rg_import', jsonb_build_object(
    'at', '2026-07-12T00:00:00Z',
    'reason', 'owner: 0.32% conversion over 1249 sends (4 in-gap orders) - import base not responding to RM25 free-coffee bar'
  ),
  'beans_idle', jsonb_build_object(
    'at', '2026-07-12T00:00:00Z',
    'reason', 'owner: +1.0pp vs holdout after 225 sends, 0 points redemptions ever - no evidence it moves anyone'
  )
))
ON CONFLICT (key) DO NOTHING;
