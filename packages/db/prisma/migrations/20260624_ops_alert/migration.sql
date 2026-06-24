-- Ops KPI Pulse alert ledger. Captured for reproducibility per
-- docs/database-migrations.md (never auto-run; apply via Supabase SQL editor /
-- MCP before flipping OPS_PULSE_MODE=armed). Matches model OpsAlert in
-- packages/db/prisma/schema.prisma.

CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "channel" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpsAlert_dedupeKey_key" ON "OpsAlert"("dedupeKey");
CREATE INDEX "OpsAlert_status_idx" ON "OpsAlert"("status");
CREATE INDEX "OpsAlert_assigneeUserId_status_idx" ON "OpsAlert"("assigneeUserId", "status");
CREATE INDEX "OpsAlert_outletId_idx" ON "OpsAlert"("outletId");
