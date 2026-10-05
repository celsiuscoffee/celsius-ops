import { describe, it, expect } from "vitest";
import { validateReadOnly, MAX_ROWS } from "./sql-guard";

const ok = (sql: string) => {
  const v = validateReadOnly(sql);
  expect(v.ok, sql).toBe(true);
  return v.ok ? v.sql : "";
};
const bad = (sql: string, reason: RegExp) => {
  const v = validateReadOnly(sql);
  expect(v.ok, sql).toBe(false);
  if (!v.ok) expect(v.reason).toMatch(reason);
};

describe("validateReadOnly", () => {
  it("passes an ordinary warehouse query and appends a LIMIT", () => {
    const sql = ok("SELECT outlet_id, SUM(nett) FROM unified_sales GROUP BY 1");
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}$`));
    expect(ok("WITH d AS (SELECT 1) SELECT * FROM d LIMIT 5")).not.toMatch(/LIMIT 5\s*\n/);
  });

  it("refuses writes, multiple statements and non-SELECT heads", () => {
    bad("DELETE FROM members", /SELECT/);
    bad("SELECT 1; DELETE FROM members", /single statement/);
    bad("SELECT 1 FROM x WHERE y IN (SELECT 1) FOR UPDATE", /allowed keyword/);
  });

  it("refuses credential columns however they are spelled", () => {
    bad('SELECT "passwordHash", pin FROM "User"', /credential/);
    bad("SELECT u.pin FROM \"User\" u", /credential/);
    bad("SELECT \"staffPin\" FROM \"Outlet\"", /credential/);
    bad("SELECT code FROM otp_codes", /credential/);
    bad("SELECT api_key FROM integrations", /credential/);
  });

  it("refuses non-public schemas and system catalogs, including via comments", () => {
    bad("SELECT email FROM auth.users", /public schema/);
    bad("SELECT * FROM storage.objects", /public schema/);
    bad("SELECT table_name FROM information_schema.tables", /public schema/);
    bad("SELECT * FROM pg_shadow", /public schema/);
    bad("SELECT current_setting('is_superuser')", /public schema/);
    bad("SELECT 1 /* pg_catalog. */ FROM auth.users", /public schema/);
    bad("-- DELETE\nSELECT 1 FROM auth.users", /public schema/);
  });

  it("does not trip on business columns or literal values that merely contain a deny-word", () => {
    ok("SELECT pinned_at FROM splash_posters");
    ok("SELECT tokens_used FROM agent_registry");
    ok("SELECT count(*) FROM agent_actions WHERE action = 'create' AND note = 'set pin'");
    ok("SELECT closed_at, release_date FROM \"Invoice\"");
  });
  it("still sees a keyword or column hidden next to a literal", () => {
    bad("SELECT 'x' FROM \"User\" FOR UPDATE", /allowed keyword/);
    bad("SELECT pin, 'ok' FROM \"User\"", /credential/);
  });
});
