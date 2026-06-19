-- Record the outcome of the outbound GrabFood auto-accept on each order.
--
-- The webhook auto-accepts incoming Grab orders via the Partner API so the order
-- leaves PENDING and Grab drives the rest of the lifecycle. That call was
-- best-effort and its failures were only console.warn — invisible once logs
-- rotate — so a broken outbound integration (bad creds / wrong GRAB_ENV / OAuth
-- failure) could strand every order at "open" for days without any queryable
-- signal. These columns make the accept outcome a fact on the order.
--
--   grab_accept_status: 'accepted' | 'failed' | 'skipped_no_creds' (null = pre-migration / non-grab)
--   grab_accept_error : the API/OAuth error message when status = 'failed'
--
-- Additive + nullable: safe to run anytime, no backfill, no impact on existing rows.

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS grab_accept_status text,
  ADD COLUMN IF NOT EXISTS grab_accept_error  text;

-- Surface the orders whose auto-accept failed/was skipped (the ones that will
-- strand) without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_pos_orders_grab_accept_status
  ON pos_orders (grab_accept_status)
  WHERE grab_accept_status IS NOT NULL AND grab_accept_status <> 'accepted';
