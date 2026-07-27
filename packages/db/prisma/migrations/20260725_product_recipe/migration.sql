-- Prep recipes (central kitchen sub-BOM) — the missing link between RAW
-- purchases and PREPPED stock.
--
-- Central Preparation (supplier CK0001) turns raw inputs into prepped products
-- that outlets consume: 10kg raw "Chicken Chop" → 10 pcs "Grilled Chicken".
-- Outlet menus already carry the PREPPED item on their MenuIngredient BOM and
-- Central Preparation's cost-only price list values it — but nothing described
-- the conversion itself. Consequences today:
--   * raw stock never depletes in theory → par-level reorder drifts upward
--     (the exact drift the consumption engine exists to prevent);
--   * raw purchases read as 100% variance against a zero theoretical
--     (Chicken Chop RM4,818 and Pull Lamb both showed as "waste" in the
--     Jul 19–24 variance drill — they are raw inputs, not leakage);
--   * no yield tracking — 10kg yielding 8 pcs instead of 10 is invisible;
--   * the transfer price is never validated against actual raw cost.
--
-- Deliberately SEPARATE from Menu/MenuIngredient: a prep item is not a sellable
-- menu row, and conflating them would pollute the customer menu and blur
-- central-kitchen yield with outlet portioning — the two failure modes the
-- variance report needs to tell apart.
--
--   cost per prepped unit = Σ(input qty × input cost) ÷ yieldQuantity
--
-- Additive only: two new tables, no writes to existing data.

-- CreateTable
CREATE TABLE "ProductRecipe" (
    "id" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(65,30) NOT NULL,
    "yieldUom" TEXT NOT NULL,
    "prepNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipeItem" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityUsed" DECIMAL(65,30) NOT NULL,
    "uom" TEXT NOT NULL,

    CONSTRAINT "ProductRecipeItem_pkey" PRIMARY KEY ("id")
);

-- One active recipe per prepped output product.
-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_outputProductId_key" ON "ProductRecipe"("outputProductId");

-- A raw input appears at most once per recipe.
-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipeItem_recipeId_productId_key" ON "ProductRecipeItem"("recipeId", "productId");

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_outputProductId_fkey"
  FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deleting a recipe removes its lines; deleting a raw Product is RESTRICTed so
-- a product still referenced by a prep recipe cannot vanish silently.
-- AddForeignKey
ALTER TABLE "ProductRecipeItem" ADD CONSTRAINT "ProductRecipeItem_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeItem" ADD CONSTRAINT "ProductRecipeItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: match the house pattern used by Menu / MenuIngredient / Product /
-- PackagingRule — enabled with NO policies, i.e. deny-all for anon and
-- authenticated PostgREST clients. The backoffice reaches these tables over its
-- direct Prisma connection (the table owner bypasses RLS), so nothing in the
-- app changes. Prisma's own DDL does not emit this, so it is added by hand:
-- without it these would be the only inventory tables any authenticated client
-- could read and write.
ALTER TABLE "ProductRecipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductRecipeItem" ENABLE ROW LEVEL SECURITY;
