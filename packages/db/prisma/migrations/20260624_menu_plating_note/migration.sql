-- Recipe Cards: per-menu-item plating / presentation note (the "plating
-- expectation" shown on the barista build card). Additive, nullable — every
-- existing Menu row is unchanged.
--
-- Applied to production (celsius-inventory) via Supabase MCP apply_migration.
-- Manual SQL only — never `prisma db push`. See docs/database-migrations.md.
ALTER TABLE "Menu" ADD COLUMN IF NOT EXISTS "platingNote" TEXT;
