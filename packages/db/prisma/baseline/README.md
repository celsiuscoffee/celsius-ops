# Schema baseline snapshot

`0000_baseline.sql` is a full DDL snapshot of the Prisma-managed schema
(`../schema.prisma`), generated for disaster recovery. Before this existed,
rebuilding the database meant reverse-engineering git history of
`schema.prisma` plus 21 incremental migration files.

**What it covers:** every model in `packages/db/prisma/schema.prisma`
(core ops: outlets, users, inventory, orders, invoices, HR, finance, ads).

**What it does NOT cover:**

- Loyalty schema — lives in `apps/loyalty/supabase/migrations/`
- Order/pickup schema — lives in `apps/order/supabase/migrations/`
- POS RPCs, RLS policies, triggers — live in `supabase/migrations/` and
  `apps/backoffice/supabase/migrations/`

Those are SQL-first and already have complete migration histories in their
respective folders; this snapshot fills the gap for the Prisma side, which
had none.

**Regenerate after schema changes** (no DB connection needed):

```bash
cd packages/db
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/baseline/0000_baseline.sql
```

This file is a recovery reference, not something to run against the live
database. Day-to-day schema changes still follow
`docs/database-migrations.md` (diff → review SQL → apply via Supabase →
commit migration file). CI's `migration-guard` job enforces that
`schema.prisma` edits ship with a migration file.
