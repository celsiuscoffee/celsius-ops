#!/usr/bin/env node
// Local Maybank statement watcher. Runs under launchd: on a folder change (or
// hourly fallback) it finds new/changed statement PDFs, extracts text with
// pdftotext, and POSTs to the backoffice ingest endpoint. Idempotent on the
// server, plus a local manifest so we only upload what's new.
//
// Config via env (set in the launchd plist):
//   CELSIUS_INGEST_URL     full URL of /api/finance/bank-statements/ingest
//   CELSIUS_INGEST_SECRET  bearer token (= FINANCE_INGEST_SECRET on the server)
//   CELSIUS_MBB_FOLDER     statements root (default: the Desktop folder)
//   CELSIUS_PDFTOTEXT      pdftotext path (default: /opt/homebrew/bin/pdftotext)
//
// Flags: --seed marks all current files processed WITHOUT uploading (used once
// after the historical backfill so the watcher only picks up new statements).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const FOLDER = process.env.CELSIUS_MBB_FOLDER || "/Users/ammarshahrin/Desktop/Celsius/Maybank Bank Statement";
const INGEST_URL = process.env.CELSIUS_INGEST_URL || "";
const SECRET = process.env.CELSIUS_INGEST_SECRET || "";
const PDFTOTEXT = process.env.CELSIUS_PDFTOTEXT || "/opt/homebrew/bin/pdftotext";
const STATE_DIR = join(homedir(), ".celsius-maybank-watcher");
const MANIFEST = join(STATE_DIR, "processed.json");
const LOG = join(STATE_DIR, "watcher.log");
const SEED = process.argv.includes("--seed");

mkdirSync(STATE_DIR, { recursive: true });
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
}

const processed = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

function listPdfs() {
  const out = [];
  let subs = [];
  try { subs = readdirSync(FOLDER); } catch (e) { log(`cannot read folder ${FOLDER}: ${e.message}`); return out; }
  for (const sub of subs) {
    const dir = join(FOLDER, sub);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith(".pdf")) out.push(join(dir, f));
  }
  return out;
}

async function main() {
  const pdfs = listPdfs();
  let done = 0, failed = 0, skipped = 0;
  for (const pdf of pdfs) {
    const key = basename(pdf);
    const mtime = statSync(pdf).mtimeMs;
    if (processed[key] && processed[key] >= mtime) { skipped++; continue; }
    if (SEED) { processed[key] = Date.now(); done++; continue; }
    if (!INGEST_URL || !SECRET) { log(`missing CELSIUS_INGEST_URL / CELSIUS_INGEST_SECRET — skipping ${key}`); failed++; continue; }
    try {
      const text = execFileSync(PDFTOTEXT, ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ text, fileName: key }),
      });
      if (res.ok) {
        processed[key] = mtime;
        done++;
        log(`OK ${key} -> ${res.status}`);
      } else {
        failed++;
        log(`FAIL ${key} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      }
    } catch (e) {
      failed++;
      log(`ERR ${key}: ${e?.message || e}`);
    }
  }
  writeFileSync(MANIFEST, JSON.stringify(processed, null, 2));
  log(`run complete: ${done} ${SEED ? "seeded" : "uploaded"}, ${failed} failed, ${skipped} unchanged`);
}

main().catch((e) => { log(`fatal: ${e?.message || e}`); process.exit(1); });
