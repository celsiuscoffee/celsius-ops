-- Force a staff member to replace a PIN that somebody else chose for them.
--
-- Owner 2026-10-24: "can we make the pin 1. using first digit ic 2. it is a
-- temp password that needs to be change on first login".
--
-- WHY. A PIN is the ENTIRE staff-app credential — there is no username and no
-- password beside it. Until now HR picked that number, told the employee, and
-- it stayed theirs forever: HR knew it permanently, it travelled through
-- WhatsApp, and nothing ever prompted a change. Deriving the temp PIN from the
-- first six digits of the IC (the date of birth) makes it predictable on
-- purpose, so HR can hand it over without inventing anything — which is only
-- safe BECAUSE this flag forces it to be replaced at first sign-in. The two
-- halves of that request do not work apart.
--
-- FALSE for every existing row: the 45 staff who already chose their own PINs
-- are not disturbed (owner scope decision, same day). Only PINs issued or
-- reset from now on carry the flag.
--
-- Enforcement is server-side, in apps/staff middleware, covering BOTH pages
-- and /api/* — a flag the client is merely asked to honour would be bypassed
-- by a stale JS bundle or a native build that never shipped the screen.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mustChangePin" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "User"."mustChangePin" IS
  'PIN was set by someone else (HR issue / manager reset) and has not been replaced by the holder. apps/staff blocks every route but change-pin while true. Cleared by /api/auth/change-pin.';
