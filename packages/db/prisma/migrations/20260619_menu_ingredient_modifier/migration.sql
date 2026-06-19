-- Temperature condition on recipe (BOM) lines, mirroring PackagingRule.modifier.
-- Lets a recipe differ by Hot/Iced (different syrup, different ml) without
-- duplicating the whole recipe — null = both, "Iced" / "Hot" scope the line.
-- Matches pos_order_items.modifiers[].name. Manual SQL only.

ALTER TABLE "MenuIngredient" ADD COLUMN IF NOT EXISTS "modifier" TEXT;
