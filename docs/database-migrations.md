# Database migration policy

## Why we don't use `prisma migrate deploy`

Per the user's standing rule (in `~/.claude/projects/.../MEMORY.md`):

> **NEVER prisma db push — drops non-Prisma tables. Use manual SQL migrations only. CRITICAL.**

The Supabase database hosts tables that aren't part of the Prisma schema:
- `auth.*` (Supabase auth)
- `storage.*` (Supabase Storage)
- Some RLS-policied tables managed via SQL only

`prisma db push` and `prisma migrate deploy` will both happily drop or alter these. So we bypass Prisma's apply path entirely — schema changes go through the Supabase MCP `apply_migration` tool or the Supabase SQL editor.

## The audit's concern

> No `migrations/` folder under `packages/db/prisma/` — schema is being maintained out-of-band via Supabase MCP / manual SQL. There is no reproducible migration history in the repo.

The fix isn't to start using `prisma migrate` (it'll break things). The fix is to capture each schema change as an SQL file in the repo so we have history.

## Going forward — the hybrid workflow

For every schema change:

1. **Edit `packages/db/prisma/schema.prisma`** with the new column / model / index.
2. **Generate the diff SQL locally** (just for inspection):
   ```bash
   cd packages/db
   npx prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --script
   ```
   This prints the SQL Prisma WOULD run if it could. Review it.
3. **Apply via Supabase MCP** (in Claude Code) or paste in the Supabase SQL editor.
4. **Save the SQL** as `packages/db/prisma/migrations/YYYYMMDD_HHMMSS_<short_name>/migration.sql`. We never run these — they exist for reproducibility / audit.
5. **Run `npx prisma generate`** to refresh the TypeScript client.
6. **Commit both** the schema change AND the migration SQL.

## Verifying a migration actually ran

```bash
npm run check:migrations          # report; exit 1 if anything is missing
npm run check:migrations -- --json
```

Needs `DIRECT_URL` (or `DATABASE_URL`). It reads every migration in
`packages/db/prisma/migrations/` **and** `supabase/migrations/`, works out what
each one would create, and asks the live database whether it is there. Supabase
migrations are reported as `supabase/<file>.sql`; use that name in
`KNOWN_UNAPPLIED.json` if one is knowingly unapplied. (Verified 2026-09-26: all
164 objects the 113 supabase files promise are present in production, so adding
the directory introduced no new drift.)

**Why this exists.** CI's `migration-guard` proves a `.sql` FILE exists beside a
`schema.prisma` change. It cannot know whether the SQL was ever RUN — these are
applied by hand. That gap bit twice in one week:

| | |
| --- | --- |
| #1233 `payslip_release_day` | Sat unapplied four days. The reader fell back to `NULL`, so "hold payslips until the 15th" was simply inert. Nobody noticed. |
| #1235 `scheduled_break_minutes` | Took **production clock-in down**. The deployed `INSERT` named a column that did not exist, and no staff member could start a shift. |

Both were invisible because the file existed and CI was green.

**Run it before merging anything that adds a migration, and after applying one.**
The CI job `migration-applied` runs it on every PR when a database URL secret is
available, and skips (does not fail) when it is not.

### What it can and cannot verify

Verified: added columns, created tables, indexes, **named** constraints, enum
types. Not verified: `INSERT`/`UPDATE` data, policies, RLS enables, functions,
`ALTER COLUMN`, `RENAME`, and constraints added without a name (Postgres
generates that name, so it cannot be predicted).

A migration containing only unverifiable statements is reported **unknown**,
never "applied" — a checker that quietly said "all clear" for the statements it
happens to understand would rebuild the exact blind spot it replaces.

### Accepting drift you have decided to live with

`packages/db/prisma/migrations/KNOWN_UNAPPLIED.json` lists migrations knowingly
not applied. They are **reported, not failed**. Every entry needs a real reason
and is meant to be temporary — resolve it by applying the migration or deleting
the file.

This exists so the check does not fail every PR from the day it lands over one
harmless pre-existing gap. A check that blocks unrelated work is a check people
turn off. Accepting drift is therefore explicit, per-migration, and written
down — never a blanket "ignore failures" switch.

If an allowlisted migration turns out to be applied after all, the check says so
and asks you to remove the entry, so the list cannot quietly rot into a place
real drift hides.

An object dropped by another migration is reported **superseded**, not missing.
That test is order-independent on purpose: filename order is not a sound proxy
for application order — `20260619_menu_packaging_service_mode` creates an index
that `20260619_menu_ingredient_uniq_modifier` drops, yet sharing a date prefix
the dropper sorts first.

## What about the existing schema?

We have a 95-model `schema.prisma` with no captured history. Options:

- **Option A — baseline as one big migration:** generate `0_baseline/migration.sql` from `prisma migrate diff --from-empty`. Captures current state but doesn't help with reproducing the path that got us here.
- **Option B — start tracking from now:** future changes get migration files; the existing schema is treated as the implicit starting point.

**Recommend Option B.** A baseline file would be a 5000+ line SQL dump that nobody reads. It's easier to recover historical state from git history of `schema.prisma` itself.

## Status

- [x] Policy documented (this file)
- [ ] First migration captured: `packages/db/prisma/migrations/20260501_token_revoked_at/migration.sql` (the User.tokenRevokedAt column added in PR #128)
- [ ] CI check that flags PRs touching `schema.prisma` without a corresponding migration file (low priority — convention enforced via PR review for now)
