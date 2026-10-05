// Read-only SQL gate shared by the data-analyst (one question, one query) and
// the Telegram intelligence agent (agentic run_sql loop). Pure — no Prisma, no
// SDK — so it is unit-tested directly.
//
// 2026-09-25 QA (Low): the agents' gate blocked writes but had no column
// deny-list, so a steered prompt could run
//   SELECT "passwordHash", pin FROM "User"
// and read every credential hash into a Telegram chat. The ops-intake
// assistant already had SQL_SENSITIVE + a schema allow-list; this ports both
// so every model-authored query in the repo goes through one rule set.

export const MAX_ROWS = 200;

// Statement kinds that can never be part of a read. Checked on the query with
// comments AND string literals removed, so `WHERE action = 'create'` is fine
// but `SELECT … FOR UPDATE` and `INSERT … ON CONFLICT DO UPDATE SET` are not.
const DISALLOWED =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|reindex|copy|merge|call|lock|set|reset|do|execute|prepare|declare|listen|notify|begin|commit|rollback|refresh|security)\b/i;

// Credential / token columns no agent may read, however the query is phrased.
// Superset of ops-intake/assistant.ts SQL_SENSITIVE.
export const SQL_SENSITIVE =
  /passwordhash|password_hash|\bpassword\b|\bpin\b|staffpin|staff_pin|\botp\b|otp_code|secret|apikey|api_key|refresh_token|access_token|webhook_url|\btoken\b/i;

// Only the public schema is the business warehouse. auth.* holds Supabase
// user credentials, storage.* signed object paths, pg_catalog/information_schema
// let a query enumerate what else exists.
const FOREIGN_SCHEMA = /\b(auth|storage|pg_catalog|information_schema|pg_toast|extensions|vault|supabase_functions)\s*\./i;
// pg_* system views/functions reachable without a schema prefix.
const SYSTEM_OBJECTS =
  /\bpg_(?:shadow|authid|user|roles|stat_activity|read_file|read_binary_file|ls_dir|settings|hba_file_rules|config)\b|\bcurrent_setting\s*\(/i;

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Identifiers and keywords only: string literals collapsed to '' so a value
 *  can neither hide a keyword nor trip the deny-lists. Quoted identifiers are
 *  kept (a "pin" column is still a pin column). */
function scrubLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

export function validateReadOnly(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  // Comments are stripped BEFORE every check so a keyword cannot hide inside
  // one, and so the SELECT-head test sees the real first token.
  let sql = stripComments(raw ?? "").trim().replace(/;+\s*$/, "");
  if (!sql) return { ok: false, reason: "empty query" };
  if (sql.includes(";")) return { ok: false, reason: "only a single statement is allowed" };
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, reason: "only SELECT / WITH queries are allowed" };
  const shape = scrubLiterals(sql);
  if (DISALLOWED.test(shape)) return { ok: false, reason: "query contains a disallowed keyword" };
  if (SQL_SENSITIVE.test(shape)) return { ok: false, reason: "credential columns are off-limits" };
  if (FOREIGN_SCHEMA.test(shape) || SYSTEM_OBJECTS.test(shape)) return { ok: false, reason: "public schema only" };
  if (!/\blimit\s+\d+/i.test(sql)) sql = `${sql}\nLIMIT ${MAX_ROWS}`;
  return { ok: true, sql };
}
