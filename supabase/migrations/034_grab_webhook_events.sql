-- Never silently lose a GrabFood order again.
--
-- grab_webhook_events: a durable log of every inbound Grab webhook + its raw
-- payload, so a dropped/skipped order is recoverable (replay from raw) and the
-- drop rate is measurable instead of invisible.
--
-- grab_reconcile_runs: bookkeeping for the reconciliation cron that diffs Grab's
-- own order list against pos_orders and backfills anything missing.

CREATE TABLE IF NOT EXISTS grab_webhook_events (
  id                 text PRIMARY KEY,
  received_at        timestamptz NOT NULL DEFAULT now(),
  method             text,
  order_id           text,          -- Grab orderID (external_id)
  short_order_number text,
  merchant_id        text,
  order_state        text,
  item_count         integer,
  action             text,          -- created|updated|noop|skipped|duplicate|no_outlet|error
  pos_order_id       text,
  error              text,
  raw                jsonb
);
CREATE INDEX IF NOT EXISTS idx_grab_webhook_events_order ON grab_webhook_events (order_id);
CREATE INDEX IF NOT EXISTS idx_grab_webhook_events_received ON grab_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_grab_webhook_events_dropped ON grab_webhook_events (received_at DESC)
  WHERE action IN ('skipped','no_outlet','error');

CREATE TABLE IF NOT EXISTS grab_reconcile_runs (
  id                 text PRIMARY KEY,
  ran_at             timestamptz NOT NULL DEFAULT now(),
  outlets            integer NOT NULL DEFAULT 0,
  grab_orders        integer NOT NULL DEFAULT 0,
  missing            integer NOT NULL DEFAULT 0,
  backfilled_full    integer NOT NULL DEFAULT 0,
  backfilled_minimal integer NOT NULL DEFAULT 0,
  errors             integer NOT NULL DEFAULT 0,
  detail             jsonb
);
