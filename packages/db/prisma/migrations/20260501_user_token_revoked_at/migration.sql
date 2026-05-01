-- Add User.tokenRevokedAt — populated by /api/auth/sign-out-all
-- so JWT tokens issued before this timestamp 401 on routes that
-- use verifyTokenWithFreshness (defense-in-depth for stolen cookies).
-- Applied via Supabase MCP on 2026-05-01.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenRevokedAt" TIMESTAMP(3);
