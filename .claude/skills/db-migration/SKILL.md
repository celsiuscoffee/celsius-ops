---
name: db-migration
description: Make a database schema change in celsius-ops. Use whenever a task requires adding/altering tables, columns, or indexes — i.e. any edit to packages/db/prisma/schema.prisma. Enforces the manual-SQL migration workflow; NEVER prisma db push or migrate deploy.
---

# Database schema change (hybrid workflow)

Canonical policy: `docs/database-migrations.md`. Summary: the Supabase database
hosts tables Prisma doesn't know about (`auth.*`, `storage.*`, SQL-managed RLS
tables). `prisma db push` and `prisma migrate deploy` will drop them. **Never
run either.** Prisma's apply path is bypassed entirely; SQL is applied manually
and committed for audit.

## Steps

1. **Edit `packages/db/prisma/schema.prisma`** with the new model/column/index.
2. **Generate the diff SQL for inspection** (this never touches the DB):
   ```bash
   cd packages/db
   npx prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --script
   ```
   Review the output. If it contains `DROP` statements you didn't intend,
   stop and investigate before going further.
3. **Get human approval before applying to production.** Show the SQL and wait.
   Apply via the Supabase MCP `apply_migration` tool or the Supabase SQL editor.
4. **Save the SQL** as
   `packages/db/prisma/migrations/YYYYMMDD_HHMMSS_<short_name>/migration.sql`.
   These files are never executed by tooling — they exist for reproducibility
   and audit, and CI's `migration-guard` job fails any PR that changes
   `schema.prisma` without one.
5. **Regenerate the client:** `cd packages/db && npx prisma generate`.
6. **Commit both** the schema change and the migration SQL in the same commit.
7. **Typecheck the apps that consume the changed models** before pushing:
   `cd apps/<app> && npx tsc --noEmit`.

## Checks

- New tables that end-users reach need an RLS decision — see `docs/rls-strategy.md`.
- If the change supports a hot POS path, check existing index conventions in
  `supabase/migrations/` (POS order hot-path indexes live there).

## Lessons

_Append dated entries when this skill misses something. Promote stable ones into
the steps above._
