#!/usr/bin/env node
// Is the live schema actually carrying every hand-applied migration in the repo?
//
// Owner 2026-09-15, after clock-in went down: "yes build the migration check."
//
// CI's migration-guard proves a .sql FILE exists beside a schema.prisma change.
// It cannot know whether the SQL was ever RUN — migrations here are applied by
// hand (hard rule 1). Twice in one week that gap shipped code ahead of the
// schema: #1233's payslip_release_day sat inert for four days, and #1235's
// scheduled_break_minutes took production clock-in down because the deployed
// INSERT named a column that did not exist.
//
//   npm run check:migrations            report, exit 1 if anything is missing
//   npm run check:migrations -- --json  same, as JSON
//
// Needs DIRECT_URL (or DATABASE_URL). Exit codes: 0 clean, 1 drift, 2 could not
// check. 2 is distinct on purpose — "I could not reach the database" must never
// read as "nothing is missing".

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "packages/db/prisma/migrations");
const JSON_OUT = process.argv.includes("--json");

// The parser is TypeScript shared with the unit tests; strip its types rather
// than duplicate the logic here, so the thing under test is the thing that runs.
const require = createRequire(import.meta.url);
let expectedObjects, droppedObjects, verdictFor, supersedeCheck;
try {
  require("tsx/cjs");
  ({ expectedObjects, droppedObjects, verdictFor, supersedeCheck } = require(join(ROOT, "packages/db/src/migration-objects.ts")));
} catch (err) {
  console.error("Could not load the migration parser (is tsx installed?):", err.message);
  process.exit(2);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set — cannot check the live schema.");
  process.exit(2);
}

// Uses the Prisma client already in the workspace rather than adding a pg
// dependency — same DATABASE_URL, no new install for anyone running this.
let prisma;
try {
  const { PrismaClient } = require("@prisma/client");
  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$queryRawUnsafe("select 1");
} catch (err) {
  console.error("Could not reach the database:", err.message);
  process.exit(2);
}

// One round trip each for the whole catalog — cheaper and more predictable than
// a query per object across ~70 migrations.
let cols, tables, indexes, constraints, types;
try {
  [cols, tables, indexes, constraints, types] = await Promise.all([
    prisma.$queryRawUnsafe(`select table_name, column_name from information_schema.columns where table_schema not in ('pg_catalog','information_schema')`),
    prisma.$queryRawUnsafe(`select table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema')`),
    prisma.$queryRawUnsafe(`select indexname from pg_indexes where schemaname not in ('pg_catalog','information_schema')`),
    prisma.$queryRawUnsafe(`select conname from pg_constraint`),
    prisma.$queryRawUnsafe(`select typname from pg_type`),
  ]);
} catch (err) {
  console.error("Could not read the live schema:", err.message);
  process.exit(2);
} finally {
  await prisma.$disconnect();
}

const colSet  = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));
const tblSet  = new Set(tables.map((r) => r.table_name));
const idxSet  = new Set(indexes.map((r) => r.indexname));
const conSet  = new Set(constraints.map((r) => r.conname));
const typSet  = new Set(types.map((r) => r.typname));

const exists = (o) => {
  switch (o.kind) {
    case "column":     return colSet.has(`${o.table}.${o.name}`);
    case "table":      return tblSet.has(o.name);
    case "index":      return idxSet.has(o.name);
    // Constraint names are unique per table, not globally; name alone is the
    // practical check and false-positives here are benign (it exists somewhere).
    case "constraint": return conSet.has(o.name);
    case "type":       return typSet.has(o.name);
    default:           return false;
  }
};

if (!existsSync(MIGRATIONS)) {
  console.error(`No migrations directory at ${MIGRATIONS}`);
  process.exit(2);
}

// Parse every migration, then let the shared (unit-tested) rule decide which
// absences are explained by a later drop — see supersedeCheck.
const parsed = [];
for (const dir of readdirSync(MIGRATIONS).sort()) {
  const file = join(MIGRATIONS, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = readFileSync(file, "utf8");
  parsed.push({ name: dir, expected: expectedObjects(sql), dropped: droppedObjects(sql) });
}

const isSuperseded = supersedeCheck(parsed);
const results = parsed.map((m) => {
  const v = verdictFor(m.expected, exists, (o) => isSuperseded(m.name, o));
  return { migration: m.name, checked: m.expected.length, ...v };
});

const missing    = results.filter((r) => r.verdict === "missing");
const unknown    = results.filter((r) => r.verdict === "unknown");
const applied    = results.filter((r) => r.verdict === "applied");
const superseded = results.filter((r) => r.verdict === "superseded");

if (JSON_OUT) {
  console.log(JSON.stringify({
    applied: applied.length, superseded: superseded.length,
    unknown: unknown.length, missing: missing.length, results,
  }, null, 2));
} else {
  const fmt = (o) =>
    o.kind === "column"     ? `column ${o.table}.${o.name}`
    : o.kind === "constraint" ? `constraint ${o.name} on ${o.table}`
    : `${o.kind} ${o.name}`;

  if (missing.length) {
    console.log(`\n✗ ${missing.length} migration${missing.length === 1 ? "" : "s"} NOT APPLIED to the live schema:\n`);
    for (const r of missing) {
      console.log(`  ${r.migration}`);
      for (const o of r.missing) console.log(`      missing ${fmt(o)}`);
    }
    console.log(`\n  Apply them via the Supabase SQL editor — hybrid workflow, docs/database-migrations.md.`);
    console.log(`  NEVER prisma db push / prisma migrate deploy.\n`);
  } else {
    console.log(`\n✓ All ${applied.length} verifiable migrations are present in the live schema.\n`);
  }
  if (superseded.length) {
    console.log(`  ${superseded.length} superseded — everything they created was dropped by a later migration:`);
    for (const r of superseded) console.log(`      ${r.migration}`);
    console.log("");
  }
  if (unknown.length) {
    console.log(`  ${unknown.length} not verifiable (data, policies, RLS, functions only) — not a failure:`);
    for (const r of unknown) console.log(`      ${r.migration}`);
    console.log("");
  }
}

process.exit(missing.length > 0 ? 1 : 0);
