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

## What about the existing schema?

We have a 95-model `schema.prisma` with no captured history. Options:

- **Option A — baseline as one big migration:** generate `0_baseline/migration.sql` from `prisma migrate diff --from-empty`. Captures current state but doesn't help with reproducing the path that got us here.
- **Option B — start tracking from now:** future changes get migration files; the existing schema is treated as the implicit starting point.

**Recommend Option B.** A baseline file would be a 5000+ line SQL dump that nobody reads. It's easier to recover historical state from git history of `schema.prisma` itself.

## Status

- [x] Policy documented (this file)
- [ ] First migration captured: `packages/db/prisma/migrations/20260501_token_revoked_at/migration.sql` (the User.tokenRevokedAt column added in PR #128)
- [ ] CI check that flags PRs touching `schema.prisma` without a corresponding migration file (low priority — convention enforced via PR review for now)
