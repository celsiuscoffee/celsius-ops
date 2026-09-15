// What a hand-applied migration PROMISES the live schema will contain.
//
// Owner 2026-09-15, after clock-in went down in production: "yes build the
// migration check."
//
// WHY THIS EXISTS. Migrations here are hand-applied SQL (hard rule 1 — Prisma
// would drop the auth.*/storage.*/RLS tables it does not know about). CI's
// migration-guard proves a .sql FILE EXISTS beside any schema.prisma change.
// Nothing proved the SQL was ever RUN. So:
//
//   #1233 (payslip_release_day) sat unapplied for four days. Harmless-looking:
//         the reader fell back to NULL, so "hold payslips until the 15th" was
//         simply inert and nobody noticed.
//   #1235 (scheduled_break_minutes) took CLOCK-IN DOWN. The deployed INSERT
//         named a column production did not have, and every staff member was
//         locked out of starting a shift until the column was added by hand.
//
// Both were invisible because the file existed and CI was green. This module
// reads what each migration would create and lets a caller ask the live
// database whether it is actually there.
//
// DELIBERATELY PARTIAL. Only statements whose result can be asserted from the
// catalog are extracted: added columns, created tables, indexes, named
// constraints, enum types. Data statements (INSERT/UPDATE), policies, RLS
// enables, functions, ALTER COLUMN and RENAME are NOT checked — asserting them
// needs semantics this cannot see.
//
// That partiality is why `verifiable` matters: a migration with no verifiable
// object is reported UNKNOWN, never "applied". A checker that quietly said
// "all clear" for the statements it happens to understand would rebuild the
// exact blind spot this replaces.

export type ExpectedObject =
  | { kind: "column"; table: string; name: string }
  | { kind: "table"; name: string }
  | { kind: "index"; name: string }
  | { kind: "constraint"; table: string; name: string }
  | { kind: "type"; name: string };

/** Strip comments and string literals so their contents never parse as SQL. */
function scrub(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
    .replace(/--[^\n]*/g, " ")           // line comments
    .replace(/'(?:[^']|'')*'/g, "''")    // single-quoted literals (COMMENT ON bodies)
    .replace(/\$\$[\s\S]*?\$\$/g, " ");  // dollar-quoted bodies (functions)
}

/** `"public"."hr_logs"` / `public.hr_logs` / `hr_logs` -> `hr_logs`. */
function bareName(raw: string): string {
  const last = raw.trim().split(".").pop() ?? "";
  return last.replace(/"/g, "").trim();
}

const ident = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const qualified = `(?:${ident}\\s*\\.\\s*)?${ident}`;

/**
 * The objects a migration's SQL would leave behind.
 *
 * Statements are split on `;` after scrubbing, so a semicolon inside a comment
 * or a COMMENT ON body cannot split one statement into two.
 */
export function expectedObjects(sql: string): ExpectedObject[] {
  const out: ExpectedObject[] = [];
  const seen = new Set<string>();
  const push = (o: ExpectedObject) => {
    const key = JSON.stringify(o);
    if (!seen.has(key)) { seen.add(key); out.push(o); }
  };

  for (const raw of scrub(sql).split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!stmt) continue;

    // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table ...
    const idx = stmt.match(
      new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualified})\\s+ON\\b`, "i"),
    );
    if (idx) { push({ kind: "index", name: bareName(idx[1]) }); continue; }

    // CREATE TABLE [IF NOT EXISTS] name ( ... )  — never CREATE TABLE AS
    const tbl = stmt.match(
      new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualified})\\s*\\(`, "i"),
    );
    if (tbl) { push({ kind: "table", name: bareName(tbl[1]) }); continue; }

    // CREATE TYPE name AS ENUM (...)
    const typ = stmt.match(new RegExp(`^CREATE\\s+TYPE\\s+(${qualified})\\s+AS\\b`, "i"));
    if (typ) { push({ kind: "type", name: bareName(typ[1]) }); continue; }

    // ALTER TABLE [IF EXISTS] [ONLY] name <actions>
    const alt = stmt.match(
      new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${qualified})\\s+([\\s\\S]+)$`, "i"),
    );
    if (!alt) continue;
    const table = bareName(alt[1]);
    const actions = alt[2];

    // One ALTER TABLE may carry several comma-separated actions.
    const addCol = new RegExp(`ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${ident})`, "gi");
    for (let m = addCol.exec(actions); m; m = addCol.exec(actions)) {
      push({ kind: "column", table, name: bareName(m[1]) });
    }
    // ADD CONSTRAINT only — a bare ADD CHECK/UNIQUE gets a generated name we
    // cannot predict, so it is left unverifiable rather than guessed at.
    const addCon = new RegExp(`ADD\\s+CONSTRAINT\\s+(${ident})`, "gi");
    for (let m = addCon.exec(actions); m; m = addCon.exec(actions)) {
      push({ kind: "constraint", table, name: bareName(m[1]) });
    }
  }
  return out;
}

/**
 * Objects a migration REMOVES. An object created by one migration and dropped
 * by a later one is absent from the live schema for a good reason — reporting
 * it as drift is how a checker earns the habit of being ignored.
 *
 * Real case: 20260619_menu_packaging_service_mode creates
 * MenuIngredient_menuId_productId_serviceMode_key, and
 * 20260619_menu_ingredient_uniq_modifier drops it for the modifier-aware one.
 * Note those two sort the WRONG way round: sharing a date prefix, the dropper
 * sorts first. Callers should treat a drop by ANY other migration as
 * explaining an absence rather than trusting a filename sort.
 */
export function droppedObjects(sql: string): ExpectedObject[] {
  const out: ExpectedObject[] = [];
  const seen = new Set<string>();
  const push = (o: ExpectedObject) => {
    const key = JSON.stringify(o);
    if (!seen.has(key)) { seen.add(key); out.push(o); }
  };

  for (const raw of scrub(sql).split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!stmt) continue;

    const dropIdx = stmt.match(new RegExp(`^DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${qualified})`, "i"));
    if (dropIdx) { push({ kind: "index", name: bareName(dropIdx[1]) }); continue; }

    const dropTbl = stmt.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${qualified})`, "i"));
    if (dropTbl) { push({ kind: "table", name: bareName(dropTbl[1]) }); continue; }

    const dropTyp = stmt.match(new RegExp(`^DROP\\s+TYPE\\s+(?:IF\\s+EXISTS\\s+)?(${qualified})`, "i"));
    if (dropTyp) { push({ kind: "type", name: bareName(dropTyp[1]) }); continue; }

    const alt = stmt.match(
      new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${qualified})\\s+([\\s\\S]+)$`, "i"),
    );
    if (!alt) continue;
    const table = bareName(alt[1]);
    const actions = alt[2];

    const dropCol = new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?(${ident})`, "gi");
    for (let m = dropCol.exec(actions); m; m = dropCol.exec(actions)) {
      push({ kind: "column", table, name: bareName(m[1]) });
    }
    const dropCon = new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?(${ident})`, "gi");
    for (let m = dropCon.exec(actions); m; m = dropCon.exec(actions)) {
      push({ kind: "constraint", table, name: bareName(m[1]) });
    }
  }
  return out;
}

export type MigrationVerdict = "applied" | "missing" | "unknown" | "superseded";

/**
 * A migration's verdict from its expected objects and the ones found live.
 *
 * `unknown` when nothing in it can be verified (a data-only or policy-only
 * migration). Reporting those as applied is exactly the false all-clear this
 * module exists to prevent.
 *
 * `superseded` when every object it created was dropped by a later migration,
 * so its absence is correct and not drift.
 */
export function verdictFor(
  expected: ExpectedObject[],
  exists: (o: ExpectedObject) => boolean,
  isSuperseded: (o: ExpectedObject) => boolean = () => false,
): { verdict: MigrationVerdict; missing: ExpectedObject[]; superseded: ExpectedObject[] } {
  if (expected.length === 0) return { verdict: "unknown", missing: [], superseded: [] };

  const superseded = expected.filter(isSuperseded);
  const live = expected.filter((o) => !isSuperseded(o));
  // Everything it created was later removed on purpose — absent by design.
  if (live.length === 0) return { verdict: "superseded", missing: [], superseded };

  const missing = live.filter((o) => !exists(o));
  return { verdict: missing.length === 0 ? "applied" : "missing", missing, superseded };
}

export type ParsedMigration = {
  /** Directory name, e.g. 20260915_attendance_scheduled_break. */
  name: string;
  expected: ExpectedObject[];
  dropped: ExpectedObject[];
};

/**
 * Builds the "is this absence explained?" test for a whole migration set:
 * an object is superseded when a migration OTHER than the one that created it
 * drops it.
 *
 * Deliberately order-independent. Filename order is not a sound proxy for the
 * order these were applied in — 20260619_menu_packaging_service_mode creates
 * MenuIngredient_menuId_productId_serviceMode_key and
 * 20260619_menu_ingredient_uniq_modifier drops it, yet sharing a date prefix
 * the DROPPER sorts first. Both record "Applied to production".
 *
 * Limitation, stated rather than hidden: a create → drop → re-create sequence
 * on one object would be wrongly excused. No such sequence exists in this repo,
 * and the alternative — trusting a filename sort — produces a permanent false
 * positive, which is how a checker earns the habit of being ignored.
 */
export function supersedeCheck(
  migrations: ParsedMigration[],
): (migrationName: string, o: ExpectedObject) => boolean {
  const dropsByKey = new Map<string, Set<string>>();
  for (const m of migrations) {
    for (const o of m.dropped) {
      const key = JSON.stringify(o);
      const set = dropsByKey.get(key) ?? new Set<string>();
      set.add(m.name);
      dropsByKey.set(key, set);
    }
  }
  return (migrationName, o) => {
    const droppers = dropsByKey.get(JSON.stringify(o));
    if (!droppers) return false;
    for (const d of droppers) if (d !== migrationName) return true;
    return false;
  };
}

/** migration directory name -> why it is knowingly not applied. */
export type KnownUnapplied = Record<string, string>;

export type DriftTriage = {
  /** Unapplied and NOT accepted — these fail the check. */
  blocking: string[];
  /** Unapplied, listed in the allowlist with a reason — reported, not failed. */
  accepted: string[];
  /**
   * Listed as unapplied but actually present now. The entry is a lie and
   * should be removed — without this an allowlist quietly rots into a place
   * where real drift can hide.
   */
  staleAllowlist: string[];
};

/**
 * Splits missing migrations into what should fail the build and what has been
 * knowingly accepted.
 *
 * WHY AN ALLOWLIST. This repo already carries one unapplied migration that
 * breaks nothing (20260803_hr_performance_deduction_waivers — the feature
 * shipped through hr_performance_overrides instead). Without a way to record
 * that decision the new check would fail every PR from the moment it landed,
 * including PRs that touch nothing near the database. A check that blocks
 * unrelated work is a check people turn off.
 *
 * Accepting drift is therefore explicit, per-migration and needs a written
 * reason — never a blanket "ignore failures" switch.
 */
export function triageDrift(
  missingMigrations: string[],
  appliedMigrations: string[],
  known: KnownUnapplied,
): DriftTriage {
  const knownNames = Object.keys(known);
  return {
    blocking: missingMigrations.filter((m) => !knownNames.includes(m)),
    accepted: missingMigrations.filter((m) => knownNames.includes(m)),
    staleAllowlist: knownNames.filter((m) => appliedMigrations.includes(m)),
  };
}
