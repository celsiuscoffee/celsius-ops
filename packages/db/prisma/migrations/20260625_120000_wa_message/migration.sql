-- Ops chat inbox: persisted WhatsApp messages (inbound staff replies + outbound
-- ops-pulse digests / replies). Captured for reproducibility per
-- docs/database-migrations.md — apply via the Supabase MCP apply_migration tool
-- or the Supabase SQL editor; never auto-run. Matches model WaMessage in
-- packages/db/prisma/schema.prisma.

CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "waMessageId" TEXT,
    "staffPhone" TEXT NOT NULL,
    "userId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "templateName" TEXT,
    "status" TEXT,
    "error" TEXT,
    "opsAlertId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaMessage_waMessageId_key" ON "WaMessage"("waMessageId");
CREATE INDEX "WaMessage_staffPhone_sentAt_idx" ON "WaMessage"("staffPhone", "sentAt");
CREATE INDEX "WaMessage_userId_idx" ON "WaMessage"("userId");
