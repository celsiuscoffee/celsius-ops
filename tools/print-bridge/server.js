#!/usr/bin/env node
/**
 * Celsius local print bridge.
 *
 * A small HTTP listener that runs on each POS device and forwards
 * print jobs to ESC/POS thermal printers on the local network.
 * The POS register + customer-display + pickup staff KDS all POST
 * here at http://localhost:8080/print (see apps/pos/src/lib/
 * sunmi-printer.ts `printToExternalPrinter` and apps/order/src/lib/
 * station-printer.ts `postToBridge`).
 *
 * Request shape:
 *   POST /print
 *   {
 *     "printer": "bar" | "counter" | "kitchen" | …   (station name, lowercased)
 *     "data":    "raw plain-text docket body",        (legacy — default font)
 *     "lines":   [{ "text", "size"?, "align"?, "bold"? }],  (styled docket)
 *     "ip":      "192.168.1.100"  (optional — from pos_printer_config)
 *     "port":    9100             (optional, default 9100)
 *   }
 *
 * Provide EITHER `data` (plain text, printed at the default cell) OR
 * `lines` (styled — each line carries its own size/align/bold and is
 * rendered with real ESC/POS codes). `lines` wins when both are present.
 *
 * Resolution order for the target printer:
 *   1. `ip` from the request body (set by the BO Printers admin via
 *      pos_printer_config). Preferred — single source of truth.
 *   2. Fallback to PRINTERS map below, keyed by station. Used when
 *      a station is referenced but no config row exists (e.g. dev
 *      testing on a single printer, or before the BO is wired up).
 *   3. 404 if neither resolves.
 *
 * The bridge only listens on 127.0.0.1, so it's not reachable from
 * outside the device. CORS is permissive within that loopback (a
 * Capacitor WebView or local browser tab is still allowed to POST).
 *
 * Zero dependencies — uses only Node built-ins so it runs unmodified
 * under Termux on Android, Node on Linux/macOS, or as a pkg-built
 * single-file binary.
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PRINT_BRIDGE_PORT || '8080', 10);

// Optional static fallback map. Loaded from ./printers.json if
// present, otherwise empty (request-body IPs only). Keys are
// lower-cased station names; values are { ip, port? }.
let PRINTERS = {};
const CONFIG_FILE = path.join(__dirname, 'printers.json');
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      PRINTERS = {};
      for (const [k, v] of Object.entries(parsed)) {
        PRINTERS[k.toLowerCase()] = { ip: v.ip, port: v.port || 9100 };
      }
      console.log(`[bridge] Loaded ${Object.keys(PRINTERS).length} printer(s) from printers.json`);
    } else {
      console.log('[bridge] No printers.json found — request-body IPs only');
    }
  } catch (e) {
    console.error('[bridge] Failed to parse printers.json:', e.message);
  }
}
loadConfig();
// Reload on file change so adding/editing printers.json doesn't
// require a service restart. Best-effort: silently ignore if the
// FS doesn't support fs.watch (some Termux setups).
try {
  fs.watchFile(CONFIG_FILE, { interval: 5000 }, () => loadConfig());
} catch { /* ignore */ }

// ── ESC/POS encoding ──────────────────────────────────────────
// Two render paths share the same control codes:
//
//   • body.data  → legacy plain-text docket. Printed at the head's
//     default cell, left-aligned. Untouched so older callers and the
//     `test:bar` curl behave exactly as before.
//
//   • body.lines → structured docket: an array of styled lines
//     ({ text, size?, align?, bold? }) rendered with real ESC/POS
//     size / bold / alignment codes. This is what lets the kitchen
//     docket print big, bold item names and a clear header hierarchy
//     instead of one flat wall of default-size text (see the pickup
//     KDS in apps/order/src/lib/station-printer.ts).
const ESC = 0x1B;
const GS = 0x1D;
const INIT     = [ESC, 0x40];       // ESC @  → reset
const ALIGN_L  = [ESC, 0x61, 0x00];
// ESC d 6 → feed 6 lines before the cut. The cutter sits ~1.5cm above
// the print line, so too small a feed slices the last line off ("- END -"
// getting cut). 6 lines clears the cutter and leaves a small tear margin.
const FEED_CUT = [ESC, 0x64, 0x06];
const CUT_FULL = [GS, 0x56, 0x00];  // GS V 0  → full cut

// Thermal heads only render their built-in codepage. Let printable
// ASCII + newline through; fold anything else (accents, smart quotes,
// emoji) to '?' so the head never garbles a line.
function asciiBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c === 0x0a ? 0x0a : c >= 0x20 && c <= 0x7e ? c : 0x3f);
  }
  return out;
}

function alignByte(a) {
  const n = a === 'center' || a === 1 ? 1 : a === 'right' || a === 2 ? 2 : 0;
  return [ESC, 0x61, n];
}
function boldByte(on) {
  return [ESC, 0x45, on ? 1 : 0];
}
// GS ! n — equal width/height multipliers (1-8). Default cell is the
// "size 24" base; we square-scale so headers and item names stand out.
function sizeByte(mult) {
  const m = Math.max(0, Math.min(7, mult - 1));
  return [GS, 0x21, (m << 4) | m];
}
// Callers think in the same point-ish sizes the SUNMI bridge uses
// (24 = base). Map to an integer cell multiplier: 24 → 1x, 42-48 → 2x,
// 72 → 3x. Mirrors the hierarchy of the native docket renderer.
function sizeMultFromPx(px) {
  return Math.max(1, Math.min(4, Math.round((px || 24) / 24)));
}

function buildEscPos(plainText) {
  const normalised = (plainText || '').replace(/\r\n/g, '\n');
  return Buffer.from([...INIT, ...ALIGN_L, ...asciiBytes(normalised), ...FEED_CUT, ...CUT_FULL]);
}

function buildEscPosFromLines(lines) {
  const out = [...INIT];
  for (const line of (lines || [])) {
    const isObj = line && typeof line === 'object';
    const text = (isObj ? line.text : line) ?? '';
    const align = isObj ? line.align : 'left';
    const bold = isObj ? !!line.bold : false;
    const mult = isObj ? sizeMultFromPx(line.size) : 1;
    out.push(...alignByte(align), ...boldByte(bold), ...sizeByte(mult));
    out.push(...asciiBytes(String(text).replace(/\r\n/g, '\n')), 0x0a);
  }
  // Reset styling before the feed/cut so the next job starts clean.
  out.push(...boldByte(false), ...sizeByte(1), ...ALIGN_L, ...FEED_CUT, ...CUT_FULL);
  return Buffer.from(out);
}

// body.raster → an ESC/POS raster bit-image (GS v 0). The caller rendered
// the docket to a 1-bit bitmap with a real font (see station-printer's
// renderDocketRaster) so the slip can use a true typeface the built-in
// dot-matrix font can't produce. Shape:
//   { widthBytes, height, dataB64 }  — dataB64 is MSB-first, row-major,
//   widthBytes bytes per row, `height` rows.
// Returns null on a malformed payload so the handler can 400.
function buildEscPosFromRaster(raster) {
  if (!raster || typeof raster !== 'object') return null;
  const widthBytes = raster.widthBytes | 0;
  const height = raster.height | 0;
  if (widthBytes <= 0 || widthBytes > 0xffff || height <= 0 || height > 0xffff) return null;
  const data = Buffer.from(String(raster.dataB64 || ''), 'base64');
  if (data.length < widthBytes * height) return null;
  const header = [
    GS, 0x76, 0x30, 0x00,          // GS v 0, mode 0 (normal)
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ];
  return Buffer.concat([
    Buffer.from([...INIT, ...alignByte('center'), ...header]),
    data,
    Buffer.from([...ALIGN_L, ...FEED_CUT, ...CUT_FULL]),
  ]);
}

// ── TCP send ──────────────────────────────────────────────────
// Raw TCP to port 9100 (standard ESC/POS over LAN). Short
// timeout because the bridge sits in the print path of an active
// order — we don't want a downed printer to hang the cashier UI.
function sendToPrinter(ip, port, payload) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      client.destroy();
      err ? reject(err) : resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`Timeout: ${ip}:${port}`)), 4000);
    client.connect(port, ip, () => {
      client.write(payload, () => {
        // 150ms drain so the printer has time to fully buffer
        // before we tear down the socket. Without this, some
        // older Epson firmwares cut the page mid-print.
        setTimeout(() => {
          clearTimeout(timeout);
          finish();
        }, 150);
      });
    });
    client.on('error', (err) => {
      clearTimeout(timeout);
      finish(err);
    });
  });
}

// ── HTTP server ───────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return json(res, 204, {});

  // Health check — useful when wiring the bridge into the kiosk
  // autostart script: `curl localhost:8080/health` should 200.
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      printers: Object.keys(PRINTERS),
      version: '1.0.0',
    });
  }

  if (req.method !== 'POST' || req.url !== '/print') {
    return json(res, 404, { error: 'Use POST /print' });
  }

  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const station = (body.printer || '').toString().toLowerCase();

    // Resolve target: request-body IP wins; fall back to local config.
    let target = null;
    if (body.ip) {
      target = { ip: String(body.ip), port: parseInt(body.port, 10) || 9100 };
    } else if (station && PRINTERS[station]) {
      target = PRINTERS[station];
    }

    if (!target) {
      return json(res, 404, { error: `No printer for station "${station}"` });
    }

    let payload;
    if (body.raster) {
      payload = buildEscPosFromRaster(body.raster);
      if (!payload) return json(res, 400, { error: 'Malformed raster payload' });
    } else if (Array.isArray(body.lines)) {
      payload = buildEscPosFromLines(body.lines);
    } else {
      payload = buildEscPos(body.data);
    }
    await sendToPrinter(target.ip, target.port, payload);
    return json(res, 200, { ok: true, sent_to: `${target.ip}:${target.port}` });
  } catch (err) {
    console.error('[bridge]', err.message);
    return json(res, 500, { error: err.message });
  }
});

// 127.0.0.1 only — the bridge is for local POS access, not LAN-wide.
// Anyone on the LAN could otherwise send arbitrary ESC/POS to any
// printer the bridge can reach.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[bridge] POST /print  →  forward ESC/POS to a thermal printer`);
  console.log(`[bridge] GET  /health →  liveness + loaded printer list`);
});

// Clean shutdown on SIGINT/SIGTERM so a `pkill` or systemd stop
// returns cleanly. Open sockets get torn down.
const shutdown = (sig) => {
  console.log(`[bridge] ${sig} received, closing`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
