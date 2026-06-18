-- GrabFood menu items learned from the PushGrabMenu webhook (/api/grab/menus).
--
-- Grab order webhooks carry NO item name — only an id + price. The PushGrabMenu
-- webhook is the one place Grab sends us its canonical menu WITH names, so we
-- persist them here. On receipt we also auto-link any item whose name uniquely
-- matches a catalogue product (sets products.grab_item_id), so future Grab order
-- lines resolve to the right product + kitchen station with no manual work.
-- This is the safety net for any Grab-internal ("MYITE…") id; when Grab sends
-- our own product id, no link is needed.
CREATE TABLE IF NOT EXISTS grab_menu_items (
  grab_item_id text PRIMARY KEY,
  merchant_id  text,
  name         text,
  price        integer,        -- minor units (sen), as Grab reports it
  category     text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Server-only (service-role webhook + privileged Prisma); no anon/auth access.
ALTER TABLE grab_menu_items ENABLE ROW LEVEL SECURITY;
