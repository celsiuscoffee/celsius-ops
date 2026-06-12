# Architecture restructure plan

_Last updated: 2026-06-12. Companion to the full codebase review (technical
+ F&B business-logic audits) run on this date._

The monorepo's biggest structural risk is that the three Expo apps
(`pos-native`, `staff-native`, `pickup-native`) live outside the npm
workspaces and re-implement shared logic by hand — most critically the
loyalty discount engine, which exists in three parallel copies:

| Implementation | Location | Lines |
|---|---|---|
| Canonical | `packages/shared/src/loyalty/` | ~1,455 |
| POS copy | `apps/pos-native/lib/loyalty.ts` | ~600 |
| Pickup copy | `apps/pickup-native/lib/rewards.ts` | ~445 |

A discount fix in one copy does not propagate to the others. The same
pattern applies to auth helpers and Supabase client setup. On top of that,
web apps run `@supabase/supabase-js` ~2.100 while native apps are pinned at
~2.45 — a 55-minor-version gap spanning auth API changes.

This plan sequences the fix from zero-risk to highest-risk. Each phase is
independently shippable and revertible.

## Phase 0 — Foundation (no runtime behavior change) ✅ DONE

- [x] CI typecheck covers all 5 web apps (pickup was missing) and all
      3 native apps (`typecheck-native` job — previously EAS built them
      with zero validation).
- [x] `migration-guard` CI job: PRs touching `schema.prisma` must include
      a migration file (`docs/database-migrations.md` workflow, now
      enforced).
- [x] Baseline schema snapshot for disaster recovery
      (`packages/db/prisma/baseline/`).
- [x] Turborepo for task orchestration (`turbo run typecheck|lint|test`).
      Build caching is deliberately OFF (`cache: false` for `build`) until
      env-var inputs are declared — a cached Next build can bake in stale
      `NEXT_PUBLIC_*` values. Typecheck/lint/test caching is safe and on.
- [x] Fixed root `typecheck` script (referenced tsconfigs that didn't
      exist — `packages/shared` and `packages/db` had no tsconfig and were
      never typechecked). All 4 packages now have tsconfig + typecheck.
- [x] Root `db:push` now delegates to the guarded `packages/db` script
      (previously bypassed the guard and could drop Supabase-managed
      tables).
- [x] Documented that `apps/pickup` is NOT dead code: it is the Capacitor
      store-listing wrapper (`com.celsiuscoffee.pickup`) whose WebView
      loads `order.celsiuscoffee.com`. Do not delete it; it ships the
      app-store presence. Its `src/` is just a splash fallback.

## Phase 1 — Safety net for money math (additive only)

Write characterization tests for the canonical discount engine BEFORE any
consolidation: `discount-engine.ts` (flat / percent / free_item /
free_upgrade / bogo / combo / override_price), `order-reward.ts`,
`active-vouchers.ts`, `affordable-catalog.ts`. Then port the same suite to
run against the POS and pickup copies to document where behavior already
diverges. These tests are the acceptance gate for Phase 3.

Risk: none (additive). Effort: ~2-3 days.

## Phase 2 — Native apps into the workspace (one app per PR)

Order: `staff-native` → `pickup-native` → `pos-native` (the till is
business-critical; it goes last, after the pattern is proven).

Per app:

1. Add the app to root `workspaces`; delete its local `package-lock.json`
   (the root lockfile takes over).
2. Update `metro.config.js` for monorepo resolution:
   `watchFolders: [workspaceRoot]`, `nodeModulesPaths` including root
   `node_modules`. Expo SDK 54 supports this well.
3. Mind the hoisting hazards: `react`/`react-native` must resolve to ONE
   copy. Verify with `npx expo-doctor` and a local `expo run:android`.
4. CI `typecheck-native` will need its install step updated (workspace
   `npm ci` at root instead of per-app).
5. **Gate: EAS preview build + physical-device smoke test before merging.**
   This is the step that cannot be verified in CI — budget a device test
   per app (login, place order, print receipt for POS).

Risk: medium — failure mode is a broken native build, caught at preview
build/device stage, revertible by dropping the workspace entry and
restoring the lockfile. Effort: ~1 day per app + device testing.

## Phase 3 — Version alignment + deduplication (the risky part, now gated)

1. Align `@supabase/supabase-js` to one version across web + native.
   Native 2.45 → 2.100 spans auth/realtime changes; test session
   persistence (AsyncStorage adapter), realtime subscriptions, and offline
   queue sync on device.
2. Point native apps at `@celsius/shared` and `@celsius/auth`; delete
   `apps/pos-native/lib/loyalty.ts` and `apps/pickup-native/lib/rewards.ts`
   once the Phase 1 test suite passes against the shared implementation
   wired into each app.
3. Align React 19.1 vs 19.2 at the same time.

Acceptance gate: Phase 1 characterization tests green against the unified
implementation + device smoke test per app. Do NOT combine with Phase 2
PRs — version bumps and workspace moves must be separately revertible.

Risk: medium-high, mitigated by test-first + per-app PRs + device gates.
Effort: ~1 week elapsed including device testing.

## Phase 4 — Decompose god-components (opportunistic, ongoing)

Largest offenders: `apps/pos-native/app/register.tsx` (4,010 lines),
`apps/backoffice/.../hr/employees/[id]/page.tsx` (3,267),
`.../loyalty/members/page.tsx` (2,612), `.../inventory/invoices/page.tsx`
(2,597), `apps/pickup-native/app/checkout.tsx` (1,915).

Rule: never a big-bang rewrite. When a file is touched for a feature,
extract the section being changed into a hook/component. Register.tsx
first targets: payment flow, receipt printing, customer lookup, orders
panel — each is independently extractable.

## Explicitly out of scope for this track

- RLS rollout, service-role key handling (security track).
- SQL-side dashboard aggregation, indexes, pagination (performance track).
- Refunds/cash-drawer/stock-deduction business logic (F&B logic track).
