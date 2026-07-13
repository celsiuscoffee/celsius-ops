-- Manual inventory valuations at a period boundary, per outlet.
--
-- The sourced P&L values COGS boundaries from physical stock counts only.
-- At the Bukku cutover the Q1 closing inventory exists as an accountant
-- figure in the Bukku report, not as a count in the app, so this table lets
-- a known-good external valuation anchor a boundary (opening inventory of
-- Q2 = Bukku's Q1 close). The COGS engine treats a row here as a valuation
-- candidate for that outlet, preferred when it sits closer to the boundary
-- than any usable count.
--
-- SQL-managed (not in Prisma), same as the other fin_* tables.

CREATE TABLE IF NOT EXISTS fin_inventory_valuations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id   text NOT NULL,
  as_of       date NOT NULL,
  value       numeric(12,2) NOT NULL CHECK (value >= 0),
  source      text NOT NULL,           -- e.g. 'bukku_q1_close'
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, as_of)
);

ALTER TABLE fin_inventory_valuations ENABLE ROW LEVEL SECURITY;
-- Server-only table: no anon/authenticated policies; service role bypasses RLS.
