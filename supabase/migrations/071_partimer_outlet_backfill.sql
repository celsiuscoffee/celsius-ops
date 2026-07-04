-- Backfill outletId on part-timer wage bank lines.
--
-- The partimer classifier rule tagged outlets only for the "Conezion
-- Putrajaya" and "Tamarind Square" venue prefixes; "Seksyen 13 Shah Alam",
-- "Gastrohub Nilai", and "IOI MALL PUTRAJAYA" lines landed with outletId
-- NULL, so PT wages per outlet could not be read from the GL side. The
-- classifier is fixed in code (bank-line-classifier.ts) for new imports;
-- this repairs the rows already ingested (June-2026 bank format onward —
-- earlier months have no venue prefix and stay NULL until a payee-name map
-- exists). fin_journal_lines are left as posted: the labour-variance loop
-- reads BankStatementLine, not the GL aggregates.
--
-- Captured for reproducibility per docs/database-migrations.md (never
-- auto-run; applied via Supabase MCP 2026-07-05).

UPDATE "BankStatementLine"
SET "outletId" = (SELECT id FROM "Outlet" WHERE name = 'Celsius Coffee Shah Alam')
WHERE category = 'PARTIMER' AND "outletId" IS NULL
  AND (description ~* '\mSEKSYEN\s*13' OR description ~* '\mSHAH\s*ALAM');

UPDATE "BankStatementLine"
SET "outletId" = (SELECT id FROM "Outlet" WHERE name = 'Celsius Coffee Nilai')
WHERE category = 'PARTIMER' AND "outletId" IS NULL
  AND description ~* '\mGASTROHUB';

UPDATE "BankStatementLine"
SET "outletId" = (SELECT id FROM "Outlet" WHERE name = 'Celsius Coffee IOI Mall')
WHERE category = 'PARTIMER' AND "outletId" IS NULL
  AND description ~* '\mIOI\s*MALL';
