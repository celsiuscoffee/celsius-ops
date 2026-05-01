-- Phase 1 of disk-IO budget relief — add indexes on hot scan paths.
-- Per pg_stat_user_tables on 2026-05-01, these tables had 60-95%
-- sequential scans because they only had PK + unique indexes.
-- Applied via Supabase MCP on 2026-05-01.

CREATE INDEX IF NOT EXISTS "Invoice_status_dueDate_idx" ON "Invoice" (status, "dueDate");
CREATE INDEX IF NOT EXISTS "Invoice_outletId_idx" ON "Invoice" ("outletId");
CREATE INDEX IF NOT EXISTS "Invoice_paidAt_idx" ON "Invoice" ("paidAt") WHERE "paidAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Order_outletId_createdAt_idx" ON "Order" ("outletId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx" ON "Order" (status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Receiving_outletId_receivedAt_idx" ON "Receiving" ("outletId", "receivedAt" DESC);
CREATE INDEX IF NOT EXISTS "SupplierProduct_supplierId_idx" ON "SupplierProduct" ("supplierId");
CREATE INDEX IF NOT EXISTS "ParLevel_outletId_idx" ON "ParLevel" ("outletId");
CREATE INDEX IF NOT EXISTS "ChecklistItem_checklistId_idx" ON "ChecklistItem" ("checklistId");
CREATE INDEX IF NOT EXISTS "hr_attendance_logs_user_clockin_idx" ON hr_attendance_logs (user_id, clock_in DESC);
