-- ==========================================
-- Per-outlet product availability override
-- ==========================================
-- Sparse "86 list" per outlet. A row is only written when an outlet
-- explicitly flips a product OFF (and the row stays around when they
-- flip it back on, with is_available=true, so we keep the audit trail
-- of who/when).
--
-- Customer-facing pickup app reads this at menu-fetch time and filters
-- out any (outlet_id, product_id) where is_available=false. Absence of
-- a row means "use the product's global is_available", which is the
-- normal/default state.
--
-- KDS / staff at the outlet are the authors of this table — they're
-- the ones who know the moment the mango syrup runs out, so the toggle
-- lives on the kitchen display screen. Backoffice can mirror later.

CREATE TABLE IF NOT EXISTS outlet_product_availability (
  outlet_id      text         NOT NULL,
  product_id     text         NOT NULL,
  is_available   boolean      NOT NULL DEFAULT false,
  -- Free-form note ("out of mango syrup", "machine down") so the next
  -- shift knows why a thing was 86'd. Not user-facing.
  reason         text,
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  -- Optional — staff user id (or display name). Not enforced as a FK
  -- because POS staff identity lives in a different table than the
  -- backoffice user table; storing free-form keeps the schema simple.
  updated_by     text,
  PRIMARY KEY (outlet_id, product_id)
);

-- Hot path: pickup app queries "what's unavailable at outlet X" on
-- every menu fetch. Partial index keeps it tight — only out-of-stock
-- rows are indexed, since the available rows don't get filtered.
CREATE INDEX IF NOT EXISTS outlet_product_availability_outlet_unavailable
  ON outlet_product_availability(outlet_id)
  WHERE NOT is_available;

-- Audit-style lookup for backoffice: "show me everything that's been
-- toggled at this outlet recently".
CREATE INDEX IF NOT EXISTS outlet_product_availability_updated
  ON outlet_product_availability(outlet_id, updated_at DESC);

-- RLS: not enabled in this migration. Staff write via the order app's
-- service-role key (bypasses RLS). Customer reads are also via service
-- role through the menu fetch. Tighten in a follow-up if/when staff
-- get direct anon-key writes.
