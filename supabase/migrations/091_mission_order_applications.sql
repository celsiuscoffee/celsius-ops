-- Idempotency ledger: an order can advance a given mission assignment AT MOST
-- once. Closes the double-completion hole in applyOrderToMission — a retried or
-- double-fired order (payment webhook + client callback, etc.) previously
-- re-advanced progress and could mint a second reward voucher. The (assignment,
-- order) primary key makes application atomic: INSERT ... ON CONFLICT DO NOTHING;
-- a 0-row result means "already applied -> skip". (Applied live 2026-07-20.)
CREATE TABLE IF NOT EXISTS mission_order_applications (
  assignment_id uuid NOT NULL,
  order_id      text NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, order_id)
);
