import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Root config for the repo-wide `npx vitest run` that CI's `test` job uses.
// Backoffice modules import via the `@/` tsconfig alias; without it resolved
// here, any backoffice test whose import chain touches `@/…` fails to even
// load (first hit: par-calc.test.ts → par-calc.ts → `@/lib/prisma`, #714).
// apps/backoffice/vitest.config.ts declares the same alias but only applies
// when vitest runs from inside that app — vitest does not auto-apply nested
// configs to a root run. `@/` is only used by backoffice code today; if
// another app adopts the alias for root-run tests, this needs a per-project
// split instead of a single mapping.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(dir, "apps/backoffice/src") },
  },
});
