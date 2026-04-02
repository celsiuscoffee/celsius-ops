-- =============================================
-- 010: Products table (synced from StoreHub)
-- Local cache of the product catalog for:
--   1. Reward targeting (applicable_products, applicable_categories)
--   2. Pickup app menu display
--   3. Delivery app catalog
-- StoreHub remains source of truth — this is a read cache.
-- =============================================

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL REFERENCES brands(id),
  storehub_product_id TEXT UNIQUE,

  -- Core product info
  name            TEXT NOT NULL,
  sku             TEXT,
  category        TEXT,
  tags            TEXT[] DEFAULT '{}',
  description     TEXT,
  image_url       TEXT,
  image_urls      TEXT[] DEFAULT '{}',

  -- Pricing
  pricing_type    TEXT DEFAULT 'fixed',   -- fixed, variable, weight
  price           DECIMAL NOT NULL DEFAULT 0,
  cost            DECIMAL,
  online_price    DECIMAL,
  grabfood_price  DECIMAL,
  tax_code        TEXT,
  tax_rate        DECIMAL DEFAULT 0,

  -- Modifiers (stored as JSONB array of groups)
  modifiers       JSONB DEFAULT '[]',

  -- Availability
  is_available    BOOLEAN DEFAULT true,
  online_channels TEXT[] DEFAULT '{}',     -- e.g. ['beep_delivery','webstore']
  is_featured     BOOLEAN DEFAULT false,
  is_preorder     BOOLEAN DEFAULT false,
  kitchen_station TEXT,

  -- Inventory
  track_stock     BOOLEAN DEFAULT false,
  stock_level     INTEGER,

  -- Sync metadata
  synced_at           TIMESTAMPTZ,
  storehub_updated_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Product variants (sizes, etc.)
CREATE TABLE IF NOT EXISTS product_variants (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  sku                 TEXT,
  barcode             TEXT,
  price               DECIMAL,
  cost                DECIMAL,
  stock_level         INTEGER,
  storehub_variant_id TEXT,
  is_available        BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Product categories (synced from StoreHub)
CREATE TABLE IF NOT EXISTS product_categories (
  id                    TEXT PRIMARY KEY,
  brand_id              TEXT NOT NULL REFERENCES brands(id),
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,
  sort_order            INTEGER DEFAULT 0,
  storehub_category_id  TEXT,
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brand_id, slug)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_storehub_id ON products(storehub_product_id);
CREATE INDEX IF NOT EXISTS idx_products_brand_category ON products(brand_id, category);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_products_online ON products USING GIN(online_channels);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_brand ON product_categories(brand_id);

-- Add new reward columns if missing
DO $$ BEGIN
  ALTER TABLE rewards ADD COLUMN IF NOT EXISTS override_price DECIMAL;
  ALTER TABLE rewards ADD COLUMN IF NOT EXISTS combo_product_ids TEXT[];
  ALTER TABLE rewards ADD COLUMN IF NOT EXISTS combo_price DECIMAL;
  ALTER TABLE rewards ADD COLUMN IF NOT EXISTS applicable_tags TEXT[];
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
