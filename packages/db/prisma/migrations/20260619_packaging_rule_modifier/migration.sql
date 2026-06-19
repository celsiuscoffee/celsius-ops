-- Hot/Iced (and any) modifier condition on packaging rules. Matches
-- pos_order_items.modifiers[].name so a rule can scope to the "Iced" or "Hot"
-- variant without splitting the menu item — the packaging diff lives on the
-- rule, not a duplicated recipe. NULL = applies regardless of temperature.
--
-- Applied to production via Supabase MCP apply_migration. Manual SQL only.

ALTER TABLE "PackagingRule" ADD COLUMN IF NOT EXISTS "modifier" TEXT;
