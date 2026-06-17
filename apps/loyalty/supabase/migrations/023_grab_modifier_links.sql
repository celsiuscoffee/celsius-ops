-- =============================================
-- 023: Map a GrabFood order modifier id → display name (+ optional product).
--
-- GrabFood order webhooks send modifiers as { id, price, quantity, tax } with
-- NO name, so add-ons print as "Add-on @ RM 0.97" on the kitchen docket instead
-- of "Oat Milk" / "Extra Shot". This table lets BackOffice link Grab's modifier
-- id to a real label; the order webhook resolves names from it.
--
-- Backoffice-owned (we don't pull these from any sync). grab_modifier_id is
-- Grab's globally-unique modifier id, so it's the primary key.
-- =============================================

CREATE TABLE IF NOT EXISTS grab_modifier_links (
  grab_modifier_id TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  product_id       TEXT REFERENCES products(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
