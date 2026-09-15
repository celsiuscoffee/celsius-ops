import { describe, it, expect } from "vitest";
import { expectedObjects, droppedObjects, verdictFor, supersedeCheck, type ExpectedObject } from "./migration-objects";

describe("expectedObjects", () => {
  it("reads the migration that took clock-in down", () => {
    // 20260915_attendance_scheduled_break, verbatim in shape. Shipped with
    // #1235 and never applied; the deployed INSERT named a column production
    // did not have, and nobody could start a shift.
    const sql = `
      -- NOTE: hr_* tables are SQL-managed; apply manually. NEVER prisma db push.
      ALTER TABLE hr_attendance_logs
        ADD COLUMN IF NOT EXISTS scheduled_break_minutes SMALLINT;

      ALTER TABLE hr_attendance_logs
        DROP CONSTRAINT IF EXISTS hr_attendance_logs_scheduled_break_minutes_range;

      ALTER TABLE hr_attendance_logs
        ADD CONSTRAINT hr_attendance_logs_scheduled_break_minutes_range
        CHECK (scheduled_break_minutes IS NULL
               OR (scheduled_break_minutes >= 0 AND scheduled_break_minutes <= 480));

      COMMENT ON COLUMN hr_attendance_logs.scheduled_break_minutes IS
        'Unpaid break; NULL = no roster row. Semicolons; inside; this; string.';
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "column", table: "hr_attendance_logs", name: "scheduled_break_minutes" },
      { kind: "constraint", table: "hr_attendance_logs", name: "hr_attendance_logs_scheduled_break_minutes_range" },
    ]);
  });

  it("reads the one that sat inert for four days", () => {
    // 20260911_payslip_release_day (#1233). Harmless-looking: the reader fell
    // back to NULL, so the feature was simply off and nobody noticed.
    const sql = `
      ALTER TABLE hr_company_settings
        ADD COLUMN IF NOT EXISTS payslip_release_day SMALLINT;
      ALTER TABLE hr_company_settings
        ADD CONSTRAINT hr_company_settings_payslip_release_day_range
        CHECK (payslip_release_day IS NULL OR (payslip_release_day BETWEEN 1 AND 28));
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "column", table: "hr_company_settings", name: "payslip_release_day" },
      { kind: "constraint", table: "hr_company_settings", name: "hr_company_settings_payslip_release_day_range" },
    ]);
  });

  it("never lets a comment or a string literal parse as SQL", () => {
    const sql = `
      -- ALTER TABLE ghost ADD COLUMN never_real TEXT;
      /* CREATE TABLE also_ghost (id int); */
      COMMENT ON TABLE real_t IS 'ALTER TABLE lie ADD COLUMN fake INT;';
      ALTER TABLE real_t ADD COLUMN IF NOT EXISTS actually_real TEXT;
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "column", table: "real_t", name: "actually_real" },
    ]);
  });

  it("handles several actions in one ALTER TABLE", () => {
    const sql = `
      ALTER TABLE t
        ADD COLUMN IF NOT EXISTS a TEXT,
        ADD COLUMN b INT,
        ADD CONSTRAINT t_a_chk CHECK (a IS NOT NULL);
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "column", table: "t", name: "a" },
      { kind: "column", table: "t", name: "b" },
      { kind: "constraint", table: "t", name: "t_a_chk" },
    ]);
  });

  it("strips schema qualification and quoting", () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS public."Weird Name" (id int);
      CREATE UNIQUE INDEX IF NOT EXISTS public.idx_a ON public.t (a);
      ALTER TABLE public."t" ADD COLUMN IF NOT EXISTS "c" INT;
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "table", name: "Weird Name" },
      { kind: "index", name: "idx_a" },
      { kind: "column", table: "t", name: "c" },
    ]);
  });

  it("reads CREATE INDEX CONCURRENTLY and enum types", () => {
    const sql = `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hot ON t (a);
      CREATE TYPE order_state AS ENUM ('new', 'done');
    `;
    expect(expectedObjects(sql)).toEqual([
      { kind: "index", name: "idx_hot" },
      { kind: "type", name: "order_state" },
    ]);
  });

  it("extracts nothing from what it cannot assert", () => {
    // Data, policies, RLS, functions, ALTER COLUMN, RENAME, DROP. Claiming any
    // of these were "applied" would be a guess.
    const sql = `
      INSERT INTO t (a) VALUES (1);
      UPDATE t SET a = 2 WHERE a = 1;
      ALTER TABLE t ENABLE ROW LEVEL SECURITY;
      CREATE POLICY p ON t FOR SELECT USING (true);
      CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;
      ALTER TABLE t ALTER COLUMN a SET NOT NULL;
      ALTER TABLE t RENAME COLUMN a TO b;
      ALTER TABLE t DROP COLUMN c;
    `;
    expect(expectedObjects(sql)).toEqual([]);
  });

  it("does not invent a name for an unnamed constraint", () => {
    // Postgres generates the name, so it cannot be predicted — better
    // unverifiable than wrong.
    expect(expectedObjects(`ALTER TABLE t ADD CHECK (a > 0);`)).toEqual([]);
  });

  it("is not fooled by CREATE TABLE AS", () => {
    expect(expectedObjects(`CREATE TABLE t2 AS SELECT * FROM t;`)).toEqual([]);
  });
});

describe("droppedObjects", () => {
  it("reads the drop that supersedes an earlier index", () => {
    // 20260619_menu_ingredient_uniq_modifier drops the index that
    // 20260619_menu_packaging_service_mode created. Without this the checker
    // reports permanent drift on a deliberately removed object — and a checker
    // that cries wolf gets ignored.
    const sql = `DROP INDEX IF EXISTS "MenuIngredient_menuId_productId_serviceMode_key";`;
    expect(droppedObjects(sql)).toEqual([
      { kind: "index", name: "MenuIngredient_menuId_productId_serviceMode_key" },
    ]);
  });

  it("reads dropped tables, types, columns and constraints", () => {
    const sql = `
      DROP TABLE IF EXISTS old_t;
      DROP TYPE IF EXISTS old_enum;
      ALTER TABLE t DROP COLUMN IF EXISTS gone, DROP CONSTRAINT IF EXISTS t_chk;
    `;
    expect(droppedObjects(sql)).toEqual([
      { kind: "table", name: "old_t" },
      { kind: "type", name: "old_enum" },
      { kind: "column", table: "t", name: "gone" },
      { kind: "constraint", table: "t", name: "t_chk" },
    ]);
  });

  it("ignores drops hidden in comments and strings", () => {
    const sql = `
      -- DROP TABLE ghost;
      COMMENT ON TABLE t IS 'DROP TABLE lie;';
      ALTER TABLE t ADD COLUMN IF NOT EXISTS a TEXT;
    `;
    expect(droppedObjects(sql)).toEqual([]);
  });
});

describe("verdictFor", () => {
  const col: ExpectedObject = { kind: "column", table: "t", name: "c" };
  const idx: ExpectedObject = { kind: "index", name: "i" };

  it("is applied when every expected object is live", () => {
    expect(verdictFor([col, idx], () => true)).toEqual({ verdict: "applied", missing: [], superseded: [] });
  });

  it("is missing, and names what is absent", () => {
    const r = verdictFor([col, idx], (o) => o.kind !== "column");
    expect(r.verdict).toBe("missing");
    expect(r.missing).toEqual([col]);
  });

  it("is UNKNOWN — never applied — when nothing can be verified", () => {
    // The whole point. A data-only migration reported "applied" would rebuild
    // the false all-clear this module exists to remove.
    expect(verdictFor([], () => true)).toEqual({ verdict: "unknown", missing: [], superseded: [] });
  });

  it("does not call a later-dropped object drift", () => {
    // The real menu-packaging case: the index is absent because a later
    // migration dropped it, not because anything was skipped.
    const r = verdictFor([idx], () => false, (o) => o.kind === "index");
    expect(r.verdict).toBe("superseded");
    expect(r.missing).toEqual([]);
    expect(r.superseded).toEqual([idx]);
  });

  it("still flags a genuinely missing object beside a superseded one", () => {
    const r = verdictFor([col, idx], () => false, (o) => o.kind === "index");
    expect(r.verdict).toBe("missing");
    expect(r.missing).toEqual([col]);
    expect(r.superseded).toEqual([idx]);
  });
});

describe("supersedeCheck", () => {
  const idx: ExpectedObject = { kind: "index", name: "old_idx" };

  it("explains an absence caused by a later migration, whatever the filenames sort like", () => {
    // The real pair: the DROPPER sorts FIRST because both share a date prefix.
    // A filename-ordered rule reports permanent drift here.
    const migrations = [
      { name: "20260619_menu_ingredient_uniq_modifier", expected: [], dropped: [idx] },
      { name: "20260619_menu_packaging_service_mode", expected: [idx], dropped: [] },
    ];
    const isSuperseded = supersedeCheck(migrations);
    expect(isSuperseded("20260619_menu_packaging_service_mode", idx)).toBe(true);
  });

  it("does not let a migration supersede its own object", () => {
    // A migration that drops-then-recreates an index still has to have it.
    const migrations = [{ name: "m1", expected: [idx], dropped: [idx] }];
    expect(supersedeCheck(migrations)("m1", idx)).toBe(false);
  });

  it("leaves an object nobody drops as drift", () => {
    const migrations = [{ name: "m1", expected: [idx], dropped: [] }];
    expect(supersedeCheck(migrations)("m1", idx)).toBe(false);
  });
});
