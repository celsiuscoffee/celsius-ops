-- GrabFood item linking — maps a Grab order item's id to our POS product.
--
-- Grab order webhooks carry Grab's OWN internal item id in item.id (e.g.
-- "MYITE2026011703281674464"), which never matches products.id (our slugs /
-- StoreHub ids). With no mapping, every Grab line falls back to
-- "Item @ RM x [MYITE..]" AND, because pos_order_items.product_id then holds
-- the unmatched Grab id, the kitchen-docket printer can't resolve a
-- kitchen_station for it (products.get(product_id) misses) — so the docket
-- never routes to the right station. This table is the missing link the order
-- webhook consults to resolve the real product (name + station).
--
-- Managed in BackOffice → Settings → Integrations → GrabFood → Item linking.
CREATE TABLE IF NOT EXISTS grab_item_links (
  grab_item_id text PRIMARY KEY,
  product_id   text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Human reference only: the fallback name / last item name seen for this
  -- Grab id, and the last observed unit price (sen) — both shown in the
  -- linking UI to help staff identify what to map an id to.
  label        text,
  last_price   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grab_item_links_product_id_idx ON grab_item_links(product_id);

-- Server-only table: the order webhook reads it with the service-role client
-- and BackOffice manages it over a privileged Prisma connection — both bypass
-- RLS. Enable RLS with no policies so it's never exposed to anon/auth clients.
ALTER TABLE grab_item_links ENABLE ROW LEVEL SECURITY;
