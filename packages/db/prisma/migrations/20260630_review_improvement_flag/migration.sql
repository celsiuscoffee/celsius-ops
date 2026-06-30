-- Happy-but-fixable review flag. A 4-5★ Google review auto-replies (no draft),
-- so the auto-reply cron asks the model whether the comment carries an
-- actionable point and lands it here when it does; the ops review-nudge then
-- surfaces it on WhatsApp. Captured for reproducibility per
-- docs/database-migrations.md (never auto-run; apply via Supabase SQL editor /
-- MCP). Matches model ReviewImprovementFlag in packages/db/prisma/schema.prisma.

CREATE TABLE "ReviewImprovementFlag" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "point" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewImprovementFlag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewImprovementFlag_reviewId_key" ON "ReviewImprovementFlag"("reviewId");
CREATE INDEX "ReviewImprovementFlag_status_createdAt_idx" ON "ReviewImprovementFlag"("status", "createdAt");
CREATE INDEX "ReviewImprovementFlag_outletId_idx" ON "ReviewImprovementFlag"("outletId");

ALTER TABLE "ReviewImprovementFlag"
    ADD CONSTRAINT "ReviewImprovementFlag_outletId_fkey"
    FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Server-only table (Prisma/service role). Enable RLS with no public policies so
-- anon/authenticated keys can't read it, matching OpsAlert/ReviewReplyDraft.
ALTER TABLE "ReviewImprovementFlag" ENABLE ROW LEVEL SECURITY;
