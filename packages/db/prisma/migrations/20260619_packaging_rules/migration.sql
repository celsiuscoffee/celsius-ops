-- Packaging rules: central, rule-based packaging assignment — the counterpart
-- to the per-recipe MenuIngredient BOM. A rule links an existing inventory
-- product (typically a perishable: cup, lid, straw, bag) to a scope (all menus
-- / a menu category / specific menus) and a channel, charged per item sold or
-- once per order. See packages/db/prisma/schema.prisma.
--
-- Applied to production via Supabase MCP apply_migration. Manual SQL only —
-- never `prisma db push`. See docs/database-migrations.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingScope') THEN
    CREATE TYPE "PackagingScope" AS ENUM ('ALL', 'CATEGORY', 'ITEMS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingChannel') THEN
    CREATE TYPE "PackagingChannel" AS ENUM ('ALL', 'DINE_IN', 'TAKEAWAY', 'GRAB', 'DELIVERY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PackagingRule" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity"  DECIMAL(65,30) NOT NULL DEFAULT 1,
  "scope"     "PackagingScope" NOT NULL DEFAULT 'ALL',
  "category"  TEXT,
  "menuIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "channel"   "PackagingChannel" NOT NULL DEFAULT 'ALL',
  "perOrder"  BOOLEAN NOT NULL DEFAULT false,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackagingRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackagingRule_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PackagingRule_isActive_idx"  ON "PackagingRule" ("isActive");
CREATE INDEX IF NOT EXISTS "PackagingRule_scope_idx"     ON "PackagingRule" ("scope");
CREATE INDEX IF NOT EXISTS "PackagingRule_productId_idx" ON "PackagingRule" ("productId");
