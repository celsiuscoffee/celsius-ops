-- Internal bug/problem reports filed over WhatsApp by owner/admin/managers (webhook
-- internal-intake branch). Worked as a queue from Claude Code; no UI in v1.
-- Idempotent (IF NOT EXISTS) per repo convention.
CREATE TABLE IF NOT EXISTS "SystemReport" (
  "id"             TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "reporterName"   TEXT NOT NULL,
  "reporterPhone"  TEXT NOT NULL,
  "outletId"       TEXT,
  "body"           TEXT NOT NULL DEFAULT '',
  "mediaUrls"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "waMessageIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "source"         TEXT DEFAULT 'whatsapp',
  "resolution"     TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemReport_status_idx" ON "SystemReport" ("status");
CREATE INDEX IF NOT EXISTS "SystemReport_reporterUserId_createdAt_idx" ON "SystemReport" ("reporterUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "SystemReport_createdAt_idx" ON "SystemReport" ("createdAt");
