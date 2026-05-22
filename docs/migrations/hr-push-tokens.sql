-- HR push tokens — applied 2026-05-22
-- Per-staff Expo push tokens for the native staff app (apps/staff-native).
-- Used by /api/staff/push/register and /api/staff/push/deregister.
--
-- Backend send code (Phase 5) targets staff by user_id, device, or topic.
-- Tokens are scoped per-user-per-device so logging in on a new device adds a
-- row instead of replacing — a user can have push on phone AND tablet.

-- User.id is text (Prisma's String @id @default(uuid()) generates text in
-- Postgres, not uuid), so user_id is text here to match.
CREATE TABLE IF NOT EXISTS hr_push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL CHECK (platform IN ('ios','android','web')),
  app_version  text,
  is_active    boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_push_tokens_user_active_idx
  ON hr_push_tokens (user_id) WHERE is_active = true;

ALTER TABLE hr_push_tokens ENABLE ROW LEVEL SECURITY;

-- Service role only — no end-user policies. Native app reads/writes via API
-- routes that use the service-role client after authenticating the caller.
