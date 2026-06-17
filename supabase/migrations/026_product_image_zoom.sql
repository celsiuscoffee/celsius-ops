-- Product-image zoom level (percentage, 50–200; 100 = no zoom), set per product
-- in BackOffice → Pickup → Menu. The zoom slider in the product form had no
-- backing column here, so saves were silently dropped and the value reverted to
-- 100 on reload. Mirrors apps/order/supabase/migrations/009 (never applied to
-- this project). Idempotent.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_zoom integer NOT NULL DEFAULT 100;
