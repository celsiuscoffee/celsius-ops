-- GrabFood menu items (names) learned from the PushGrabMenu webhook.
--
-- Grab order webhooks carry NO item name — only Grab's own item id ("MYITE…")
-- and a price. The PushGrabMenu webhook (/api/pos/grab/menus) is where Grab
-- sends us its canonical menu, which DOES carry the item name. We persist that
-- here so the item-linking screen can show the real name (not just a price) and
-- so items can be auto-linked to our product by name.
CREATE TABLE IF NOT EXISTS grab_menu_items (
  grab_item_id text PRIMARY KEY,
  merchant_id  text,
  name         text,
  price        integer,        -- sen, as Grab reports it
  category     text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Server-only (service-role webhook + privileged Prisma); no anon/auth access.
ALTER TABLE grab_menu_items ENABLE ROW LEVEL SECURITY;
