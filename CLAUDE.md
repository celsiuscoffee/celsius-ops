# celsius-ops

Operations monorepo for Celsius Coffee (Malaysian coffee chain). Runs the business
end-to-end: POS/till, kitchen pickup displays, online ordering, staff/manager apps,
and a back-office admin (finance, inventory, HR/payroll, marketing loops). Actively
replacing StoreHub (POS — retired ~2026-06) and Bukku (accounting — replaced by the
agentic Finance module).

## Session protocol

- **Start of session:** read `docs/STATE.md`. It holds verified facts, open
  failures, lessons, and a resume pointer from the previous session.
- **End of session:** update `docs/STATE.md` before finishing — new verified
  facts, anything that failed and why, and where the next session should pick up.
- **After a task covered by a skill** in `.claude/skills/`: if you learned
  something the skill didn't cover, append it to that skill's *Lessons* section.

## Layout

npm workspaces + Turborepo. Workspace members: `apps/{backoffice,order,pickup,staff,staff-native}` and `packages/*`.

| Path | What it is |
| --- | --- |
| `apps/backoffice` | Next.js 16 admin console — finance, inventory, HR/payroll, procurement, marketing loops. Dev port 3003. |
| `apps/order` | Next.js 16 customer online-ordering app. Dev port 3007. |
| `apps/staff` | Next.js 16 staff web app. Dev port 3006. |
| `apps/pickup` | Next.js + Capacitor shell for the kitchen/pickup display (KDS). |
| `apps/pickup-native` | Expo/React Native KDS ("Celsius Coffee"). **Outside the npm workspace** — own `package-lock.json`. |
| `apps/pos-native` | Expo/React Native POS for SUNMI registers ("Celsius POS"); native modules in `modules/`. **Outside the npm workspace** — own `package-lock.json`. |
| `apps/staff-native` | Expo/React Native manager app ("Celsius Manager"); the only native app *inside* the workspace. |
| `packages/db` | Prisma schema — **source of truth** for the database. Migrations are hand-applied SQL (see hard rule 1). |
| `packages/{auth,shared,ui}` | Shared auth, utilities/types, UI components. |
| `tools/print-bridge` | LAN HTTP bridge forwarding ESC/POS jobs to thermal printers. |

For `pos-native` / `pickup-native`, run `npm ci` *inside the app directory* —
the root install does not cover them.

## Commands

```bash
npm test                                # vitest, from root
cd apps/<app> && npx tsc --noEmit       # typecheck (what CI runs)
cd apps/<app> && npx eslint .           # lint — order/staff/backoffice only
cd apps/<app> && npx next build         # production build check
```

CI (`.github/workflows/ci.yml`) runs: tests, per-app typecheck (including
`pos-native`/`pickup-native` with their own installs), lint, production builds,
and the migration guard. Always typecheck before pushing.

## Hard rules

1. **NEVER run `prisma db push` or `prisma migrate deploy`.** The Supabase
   database hosts non-Prisma tables (`auth.*`, `storage.*`, SQL-managed RLS
   tables) that Prisma will drop. Schema changes follow the hybrid workflow in
   the `db-migration` skill / `docs/database-migrations.md`.
2. **Any edit to `packages/db/prisma/schema.prisma` must ship with a matching
   SQL file under `packages/db/prisma/migrations/`** — the `migration-guard` CI
   job fails the PR otherwise.
3. **`apps/order` runs a Next.js with breaking changes** vs. your training data.
   Read the relevant guide in `node_modules/next/dist/docs/` before writing code
   there (see `apps/order/AGENTS.md`).
4. **Lint `any`-suppression markers are a ratchet** — reduce, never add
   (grep `"ratchet: reduce, never add"`).
5. **A merge to `main` touching `apps/pos-native`, `apps/pickup-native`, or
   `apps/staff-native` is a production deploy** — the OTA workflows push the JS
   bundle to live tills/KDS screens on the next app launch. See the
   `ota-release` skill before merging native-app changes.
6. **Keep a human in the loop** for: applying migrations to the production
   database, anything touching payroll or payments, and `pos-native` releases.
   Propose, show the diff/SQL, wait for approval.

## Where things are documented

- `docs/STATE.md` — cross-session state (read first, update last)
- `docs/database-migrations.md`, `docs/rls-strategy.md`, `docs/monitoring-setup.md` — platform runbooks
- `docs/finance-module-spec.md`, `docs/hr-payroll-spec.md` — module specs
- `docs/design/` — business-loop specs and retrospectives (procurement, ops KPI
  pulse, reviews recovery, SMS/loyalty, GBP)
- `.claude/skills/` — executable runbooks (db-migration, ota-release,
  procurement-e2e, finance-module, sentry-triage)
- `.claude/workflows/` — named multi-agent workflows (rls-audit)
