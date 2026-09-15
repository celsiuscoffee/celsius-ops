#!/usr/bin/env node
// Owner to-do scanner. Runs under launchd on the owner's Mac (hourly + a
// 23:30 catch-up). Reads the WhatsApp Desktop chat store — a plain SQLite
// file on this machine, nothing talks to WhatsApp's servers — and ships the
// chats that have NEW messages since the last run, each with a 24h context
// window, to the backoffice ingest endpoint. The model extraction, agent mode
// gating, dedup and ledger all happen server-side; this script stays dumb.
// Design: docs/design/owner-todo-kanban.md.
//
// Config via env (set in the launchd plist):
//   CELSIUS_TODO_INGEST_URL   full URL of /api/owner/todo/ingest
//   CELSIUS_INGEST_SECRET     bearer token (= OWNER_TODO_INGEST_SECRET or
//                             FINANCE_INGEST_SECRET on the server)
//   CELSIUS_WA_DB             ChatStorage.sqlite path (default: WhatsApp's)
//   CELSIUS_SQLITE            sqlite3 binary (default: /usr/bin/sqlite3)
//
// Flags:
//   --dry-run   build the payload and print a summary; no POST, no state change
//   --seed      mark everything up to now as seen WITHOUT posting (first install)
//   --since=H   override the "new" window in hours for a first run (default 24)
//
// State: ~/.celsius-owner-todo/state.json holds the high-water mark (the
// largest ZWAMESSAGE.Z_PK shipped) and an optional mutedChats list of jids.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const HOME = homedir();
const WA_DB = process.env.CELSIUS_WA_DB || join(HOME, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
const SQLITE = process.env.CELSIUS_SQLITE || "/usr/bin/sqlite3";
const INGEST_URL = process.env.CELSIUS_TODO_INGEST_URL || "";
const SECRET = process.env.CELSIUS_INGEST_SECRET || "";
const STATE_DIR = join(HOME, ".celsius-owner-todo");
const STATE_FILE = join(STATE_DIR, "state.json");
const LOG = join(STATE_DIR, "scanner.log");
const DRY = process.argv.includes("--dry-run");
const SEED = process.argv.includes("--seed");
const SINCE_H = Number((process.argv.find((a) => a.startsWith("--since=")) ?? "").split("=")[1]) || 24;

// Core Data stores dates as seconds since 2001-01-01.
const CORE_DATA_EPOCH = 978307200;
const CONTEXT_HOURS = 24;
const MAX_NEW_WINDOW_HOURS = 72; // never ship more than 3 days in one go
const MAX_MSGS_PER_CHAT = 150;
// Message types that carry human-authored text: 0 text, 7 text with a link
// preview, 8 document (the filename is useful context). Everything else is
// media without text, group/system events, or WhatsApp's own notices.
const TEXT_TYPES = [0, 7, 8];

mkdirSync(STATE_DIR, { recursive: true });
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { lastPk: 0, mutedChats: [] }; }
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// WhatsApp keeps the store in WAL mode and holds it open. Copy all three files
// together so the snapshot is consistent, then read the copy read-only.
function snapshotDb() {
  if (!existsSync(WA_DB)) throw new Error(`WhatsApp store not found at ${WA_DB}`);
  const dir = join(tmpdir(), `celsius-wa-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "ChatStorage.sqlite");
  copyFileSync(WA_DB, dest);
  for (const suffix of ["-wal", "-shm"]) if (existsSync(WA_DB + suffix)) copyFileSync(WA_DB + suffix, dest + suffix);
  return { dir, dest };
}

function query(db, sql) {
  const out = execFileSync(SQLITE, ["-json", "-readonly", db, sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : [];
}

function toIso(coreDataSeconds) {
  return new Date((Number(coreDataSeconds) + CORE_DATA_EPOCH) * 1000).toISOString();
}

function shortJid(jid) {
  return String(jid || "").split("@")[0].slice(-6);
}

async function main() {
  const state = loadState();
  const muted = new Set(state.mutedChats || []);
  const { dir, dest } = snapshotDb();
  try {
    const [{ maxPk }] = query(dest, "select coalesce(max(Z_PK),0) as maxPk from ZWAMESSAGE");
    if (SEED) {
      saveState({ ...state, lastPk: maxPk, seededAt: new Date().toISOString() });
      log(`seeded high-water mark at pk ${maxPk}; nothing posted`);
      return;
    }

    const nowCd = Math.floor(Date.now() / 1000) - CORE_DATA_EPOCH;
    const contextFrom = nowCd - CONTEXT_HOURS * 3600;
    const newFloor = nowCd - MAX_NEW_WINDOW_HOURS * 3600;
    // "New" = above the high-water mark. On a first run (no mark) fall back to
    // the last SINCE_H hours so the first ingest is not the whole history.
    const firstRun = !state.lastPk;
    const newCond = firstRun
      ? `m.ZMESSAGEDATE > ${nowCd - SINCE_H * 3600}`
      : `m.Z_PK > ${state.lastPk} and m.ZMESSAGEDATE > ${newFloor}`;
    const typeList = TEXT_TYPES.join(",");

    const chats = query(
      dest,
      `select distinct s.Z_PK as sessionPk, s.ZCONTACTJID as jid, s.ZPARTNERNAME as name, s.ZSESSIONTYPE as sessionType
         from ZWAMESSAGE m join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION
        where ${newCond} and s.ZSESSIONTYPE in (0,1)
          and m.ZTEXT is not null and length(trim(m.ZTEXT)) > 0 and m.ZMESSAGETYPE in (${typeList})`,
    );

    const payload = { source: "whatsapp", chats: [] };
    let shippedMaxPk = state.lastPk || 0;
    let newCount = 0;
    for (const c of chats) {
      if (muted.has(c.jid)) continue;
      const rows = query(
        dest,
        `select m.Z_PK as pk, m.ZMESSAGEDATE as d, m.ZISFROMME as fromMe, m.ZTEXT as text,
                g.ZCONTACTNAME as memberName, g.ZMEMBERJID as memberJid, m.ZFROMJID as fromJid,
                p.ZTEXT as parentText,
                case when ${newCond.replace(/m\./g, "m.")} then 1 else 0 end as isNew
           from ZWAMESSAGE m
           left join ZWAGROUPMEMBER g on g.Z_PK = m.ZGROUPMEMBER
           left join ZWAMESSAGE p on p.Z_PK = m.ZPARENTMESSAGE
          where m.ZCHATSESSION = ${c.sessionPk}
            and m.ZTEXT is not null and length(trim(m.ZTEXT)) > 0 and m.ZMESSAGETYPE in (${typeList})
            and (m.ZMESSAGEDATE > ${contextFrom} or (${newCond}))
          order by m.ZMESSAGEDATE desc limit ${MAX_MSGS_PER_CHAT}`,
      ).reverse();
      if (!rows.some((r) => r.isNew)) continue;
      const isGroup = c.sessionType === 1;
      const messages = rows.map((r) => {
        const sender = r.fromMe
          ? "me"
          : isGroup
            ? r.memberName || (r.memberJid || r.fromJid ? `member ${shortJid(r.memberJid || r.fromJid)}` : "member")
            : c.name || shortJid(c.jid);
        if (r.isNew) { newCount++; if (r.pk > shippedMaxPk) shippedMaxPk = r.pk; }
        return {
          id: String(r.pk),
          ts: toIso(r.d),
          fromMe: !!r.fromMe,
          sender: String(sender).slice(0, 120),
          text: String(r.text).slice(0, 4000),
          replyTo: r.parentText ? String(r.parentText).slice(0, 600) : null,
          isNew: !!r.isNew,
        };
      });
      payload.chats.push({ chatId: c.jid, chatName: c.name || shortJid(c.jid), isGroup, messages });
    }

    log(`${payload.chats.length} chat(s) with ${newCount} new message(s) since pk ${state.lastPk || "(first run)"}; store max pk ${maxPk}`);
    if (!payload.chats.length) {
      if (!firstRun) saveState({ ...state, lastPk: maxPk, lastRunAt: new Date().toISOString() });
      return;
    }
    if (DRY) {
      for (const c of payload.chats) {
        const n = c.messages.filter((m) => m.isNew).length;
        log(`  ${c.isGroup ? "[group]" : "[1:1]  "} ${c.chatName}: ${n} new / ${c.messages.length} in window`);
      }
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      log(`dry run: payload ${(bytes / 1024).toFixed(0)} KB, not posted, state unchanged`);
      return;
    }
    if (!INGEST_URL || !SECRET) { log("missing CELSIUS_TODO_INGEST_URL / CELSIUS_INGEST_SECRET; not posted"); return; }

    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) { log(`ingest failed ${res.status}: ${text.slice(0, 300)} (high-water mark kept, will retry)`); process.exitCode = 1; return; }
    log(`ingest ok: ${text.slice(0, 300)}`);
    // Advance to the store's max so untexted rows do not keep the mark behind.
    saveState({ ...state, lastPk: Math.max(shippedMaxPk, maxPk), lastRunAt: new Date().toISOString() });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { log(`fatal: ${e.stack || e.message}`); process.exitCode = 1; });
