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
 *     "data":    "raw plain-text docket body",
 *     "ip":      "192.168.1.100"  (optional — from pos_printer_config)
 *     "port":    9100             (optional, default 9100)
 *   }
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
// Minimal control codes. The POS already formats the docket as
// plain text with 32-col width — we just init the printer, write
// the body, eject, and cut. No fancy fonts needed; the SUNMI/
// Epson/Star thermal printers we target render plain ASCII
// faithfully at the default 12x24 cell.
const ESC = 0x1B;
const GS = 0x1D;
const INIT     = Buffer.from([ESC, 0x40]);       // ESC @  → reset
const ALIGN_L  = Buffer.from([ESC, 0x61, 0x00]);
const FEED_3   = Buffer.from([ESC, 0x64, 0x03]); // ESC d 3 → feed 3 lines
const CUT_FULL = Buffer.from([GS, 0x56, 0x00]);  // GS V 0  → full cut

function buildEscPos(plainText) {
  const body = Buffer.from(plainText || '', 'utf8');
  // Normalise newlines so a CRLF body doesn't double-feed
  const normalised = Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return Buffer.concat([INIT, ALIGN_L, normalised, FEED_3, CUT_FULL]);
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

    const payload = buildEscPos(body.data);
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
