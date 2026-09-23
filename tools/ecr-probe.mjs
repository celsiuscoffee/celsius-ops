#!/usr/bin/env node
/**
 * ECR terminal probe — a field diagnostic you run on a laptop that is on the
 * SAME Wi-Fi/LAN as the payment terminal. Zero dependencies, no build step:
 *
 *     node tools/ecr-probe.mjs scan 192.168.0
 *     node tools/ecr-probe.mjs probe 192.168.0.150 33898
 *     node tools/ecr-probe.mjs sale  192.168.0.150 33898 10 --yes
 *
 * Why this exists: the terminal only answers on the shop LAN, and we do not
 * yet hold the vendor's response-message specification. This captures the RAW
 * bytes the terminal replies with, so the response parser can be written from
 * observed behaviour rather than guesswork.
 *
 * SAFETY — read before running:
 *   • `scan` and `probe` never move money. `probe` sends QUERY STATUS for a
 *     reference that does not exist, so the worst case is a "not found" reply.
 *   • `sale` DOES charge a real card/QR. It refuses to run without --yes, and
 *     the amount is in SEN (10 = RM0.10). Use the smallest amount allowed.
 *   • `settle` is NOT offered here: settlement closes the batch and submits
 *     transactions for payout. Do that from the terminal's own menu.
 *
 * Every byte sent and received is printed as hex and appended to
 * ecr-probe-log.txt next to wherever you run it. Send that file back — it is
 * exactly what is needed to finish the integration.
 *
 * The framing/CRC below is a deliberate standalone copy of the canonical codec
 * in packages/shared/src/ghl/frame.ts (which has the vendor-sample tests), so
 * this file can be copied onto any laptop and run on its own.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const LOG = path.resolve(process.cwd(), "ecr-probe-log.txt");
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try { fs.appendFileSync(LOG, stamped + "\n"); } catch { /* console is enough */ }
}

// ── GHL framing (CRC-16/ARC) ────────────────────────────────────────────────
const STX = 0x02, ETX = 0x03;
const HEADER = Buffer.from([0x00, 0x0c, 0x01, 0x0b, 0x01]);
const CMD = { SALE: 0xa1, VOID: 0xa2, SETTLEMENT: 0xa3, QUERY_STATUS: 0xe3, REPRINT: 0xe6 };
const TAG = { AMOUNT: 0xc001, ECR_REF: 0xc013, PRODUCT_ID: 0xc01a };

function crc16Arc(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}
function bcd6(sen) {
  const d = String(sen).padStart(12, "0");
  if (d.length > 12) throw new RangeError("amount too large");
  return Buffer.from(d.match(/../g).map((p) => (Number(p[0]) << 4) | Number(p[1])));
}
function tlv(tag, value) {
  const v = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "ascii");
  const h = Buffer.alloc(4);
  h.writeUInt16BE(tag, 0); h.writeUInt16BE(v.length, 2);
  return Buffer.concat([h, v]);
}
function frame(cmd, tlvs = []) {
  const body = Buffer.concat(tlvs);
  if (body.length > 0xff) throw new RangeError("TLV payload too long for the 1-byte length field");
  const covered = Buffer.concat([HEADER, Buffer.from([cmd, 0x00, 0x00, body.length]), body]);
  const crc = Buffer.alloc(2); crc.writeUInt16BE(crc16Arc(covered), 0);
  return Buffer.concat([Buffer.from([STX]), covered, crc, Buffer.from([ETX])]);
}

// ── Best-effort structural read of whatever comes back ──────────────────────
function describe(buf) {
  const out = [];
  out.push(`  raw hex : ${buf.toString("hex").toUpperCase()}`);
  const printable = buf.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
  out.push(`  ascii   : ${printable}`);
  if (buf.length >= 12 && buf[0] === STX) {
    const covered = buf.subarray(1, buf.length - 3);
    const got = buf.readUInt16BE(buf.length - 3);
    const ok = crc16Arc(covered) === got;
    out.push(`  framing : STX ok, ETX=0x${buf[buf.length - 1].toString(16)}, ` +
             `CRC=${got.toString(16).toUpperCase()} ${ok ? "VALID (CRC-16/ARC confirmed)" : "MISMATCH"}`);
    const cmd = covered[HEADER.length];
    const tlvLen = covered[HEADER.length + 3];
    out.push(`  command : 0x${cmd.toString(16).toUpperCase()}   tlvLen=${tlvLen}`);
    let body = covered.subarray(HEADER.length + 4), i = 0;
    while (i + 4 <= body.length) {
      const tag = body.readUInt16BE(i), len = body.readUInt16BE(i + 2);
      if (i + 4 + len > body.length) { out.push(`  TLV     : truncated at offset ${i}`); break; }
      const val = body.subarray(i + 4, i + 4 + len);
      const asTxt = val.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
      out.push(`  TLV     : tag ${tag.toString(16).toUpperCase().padStart(4, "0")} len ${String(len).padStart(3)}  ` +
               `hex=${val.toString("hex").toUpperCase()}  txt="${asTxt}"`);
      i += 4 + len;
    }
  } else {
    out.push("  framing : not a GHL-style STX frame — could be a different protocol (e.g. JSON).");
    const t = buf.toString("utf8").trim();
    if (t.startsWith("{")) out.push(`  json?   : ${t.slice(0, 400)}`);
  }
  return out.join("\n");
}

function exchange(host, port, payload, { waitMs = 90_000, label = "" } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const sock = new net.Socket();
    const finish = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      const buf = Buffer.concat(chunks);
      log(`<- ${label} ${buf.length} byte(s) [${why}]`);
      if (buf.length) log(describe(buf));
      else log("  (nothing received — see notes at the end of this run)");
      resolve(buf);
    };
    const timer = setTimeout(() => finish("timeout"), waitMs);
    sock.setTimeout(waitMs);
    sock.on("timeout", () => finish("socket idle"));
    sock.on("data", (d) => {
      chunks.push(d);
      log(`   …received ${d.length} byte(s), still listening (${chunks.reduce((n, c) => n + c.length, 0)} total)`);
    });
    sock.on("error", (e) => { log(`!! socket error: ${e.message}`); finish("error"); });
    sock.on("close", () => finish("terminal closed the connection"));
    sock.connect(port, host, () => {
      log(`-> connected ${host}:${port}`);
      log(`-> ${label} ${payload.toString("hex").toUpperCase()}`);
      sock.write(payload);
    });
  });
}

// ── Commands ────────────────────────────────────────────────────────────────
const CANDIDATE_PORTS = [33898, 8080, 9100, 1234, 5000, 4000, 10009, 88, 8000, 7777];

async function scan(prefix) {
  log(`Scanning ${prefix}.1-254 on ports ${CANDIDATE_PORTS.join(", ")} (this takes a minute)…`);
  const found = [];
  const tryOne = (host, port) => new Promise((res) => {
    const s = new net.Socket();
    s.setTimeout(700);
    s.on("connect", () => { s.destroy(); res({ host, port }); });
    s.on("timeout", () => { s.destroy(); res(null); });
    s.on("error", () => { s.destroy(); res(null); });
    s.connect(port, host);
  });
  for (let i = 1; i <= 254; i += 1) {
    const host = `${prefix}.${i}`;
    const hits = (await Promise.all(CANDIDATE_PORTS.map((p) => tryOne(host, p)))).filter(Boolean);
    for (const h of hits) { log(`  OPEN  ${h.host}:${h.port}`); found.push(h); }
  }
  log(found.length
    ? `Done. ${found.length} open port(s). The terminal is most likely one of these — try: node tools/ecr-probe.mjs probe <host> <port>`
    : "Done. Nothing open. Check the laptop is on the same Wi-Fi as the terminal, and read the terminal's IP/port from its own ECR settings menu.");
}

const ref = () => "TEST" + Date.now().toString().slice(-8);

async function probe(host, port) {
  log("=== SAFE PROBE — query status for a reference that does not exist. No money moves. ===");
  await exchange(host, port,
    frame(CMD.QUERY_STATUS, [tlv(TAG.AMOUNT, bcd6(10)), tlv(TAG.ECR_REF, ref())]),
    { label: "QUERY_STATUS", waitMs: 20_000 });
  log("");
  log("If the reply above is a valid STX frame, the protocol and CRC are confirmed and");
  log("the response format can be written from it. If nothing came back, note that the");
  log("vendor said TCP ECR does not send an ACK — some terminals stay silent until a");
  log("transaction actually runs, so the next step is a real RM0.10 sale.");
}

async function sale(host, port, sen, duitnow) {
  const tlvs = [tlv(TAG.AMOUNT, bcd6(sen)), tlv(TAG.ECR_REF, ref())];
  if (duitnow) tlvs.push(tlv(TAG.PRODUCT_ID, "DUITNOW QR"));
  log(`=== REAL SALE of ${(sen / 100).toFixed(2)} MYR${duitnow ? " via DuitNow QR" : " (card)"} — this CHARGES. ===`);
  log("Follow the terminal screen: present card or scan the QR. Waiting up to 90s.");
  await exchange(host, port, frame(CMD.SALE, tlvs), { label: "SALE", waitMs: 90_000 });
  log("");
  log("If approved, void it from the terminal menu (or tell me and we will add VOID).");
}

const [cmd, ...rest] = process.argv.slice(2);
const yes = rest.includes("--yes");
const duitnow = rest.includes("--duitnow");
const args = rest.filter((a) => !a.startsWith("--"));

log(`--- ecr-probe run: ${cmd ?? "(no command)"} ${args.join(" ")} ---`);
try {
  if (cmd === "scan" && args[0]) await scan(args[0]);
  else if (cmd === "probe" && args[1]) await probe(args[0], Number(args[1]));
  else if (cmd === "sale" && args[2]) {
    if (!yes) {
      log("Refusing: `sale` charges a real card. Re-run with --yes if that is intended.");
    } else await sale(args[0], Number(args[1]), Number(args[2]), duitnow);
  } else {
    console.log(`
ECR terminal probe — run on a laptop on the SAME network as the terminal.

  node tools/ecr-probe.mjs scan 192.168.0              find the terminal (safe)
  node tools/ecr-probe.mjs probe <host> <port>         query status (safe, no charge)
  node tools/ecr-probe.mjs sale <host> <port> <sen> --yes            real card charge
  node tools/ecr-probe.mjs sale <host> <port> <sen> --yes --duitnow  real DuitNow QR charge

Amounts are in SEN: 10 = RM0.10. Everything is logged to ecr-probe-log.txt —
send that file back.
`);
  }
} catch (e) {
  log(`!! ${e.stack || e.message}`);
}
log(`--- end of run (log: ${LOG}) ---`);
