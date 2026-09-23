/**
 * GHL / NTT Data ADAPTIS card terminal — POS client.
 *
 * Talks to the terminal on the outlet LAN (PayHereDirect, "Device Interface"
 * protocol). Card sale is the priority path; DuitNow QR is the same SALE
 * command plus one tag and is wired here too, but the H2H DuitNow API is a
 * separate integration and is not this file.
 *
 * ── What is PROVEN and what is ASSUMED ──────────────────────────────────────
 * PROVEN — the request side. The framing, the BCD amount and the CRC below are
 * reproduced byte-for-byte from the vendor's seven published sample commands;
 * the same codec lives in packages/shared/src/ghl/frame.ts with those samples
 * as tests. (Duplicated rather than imported because pos-native is not part of
 * the npm workspace, so @celsius/shared does not resolve here. Keep the two in
 * step; the shared copy is the tested one.)
 *
 * ASSUMED — nothing about the RESPONSE. The vendor's Device Interface manual
 * defines the result codes and we do not hold it, and no terminal reply has
 * been captured yet. So `interpretSaleResponse` deliberately never returns
 * "approved": it reports the raw reply and asks the cashier to read the
 * terminal. Guessing here is how you book a sale that was never paid — and how
 * "TXNID_NOT_FOUND" nearly got reported as a decline on the Maybank client.
 * Fill it in from the manual, or from a captured reply, and nothing else in
 * this file needs to change.
 *
 * ── Transport ───────────────────────────────────────────────────────────────
 * Which transport PayHereDirect speaks is still open: the terminal advertises
 * http://<ip> on its home screen and the vendor pointed at Postman, but the
 * sample commands are STX/ETX framed binary. Both are implemented; "auto"
 * tries HTTP then falls back to the socket. Settings → Terminal Diagnostic
 * answers this empirically.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Frame codec (mirror of packages/shared/src/ghl/frame.ts) ────────────────
const STX = 0x02, ETX = 0x03;
const HEADER = Uint8Array.from([0x00, 0x0c, 0x01, 0x0b, 0x01]);
export const GhlCmd = { SALE: 0xa1, VOID: 0xa2, SETTLE: 0xa3, QUERY: 0xe3, REPRINT: 0xe6 } as const;
const TAG = { AMOUNT: 0xc001, ECR_REF: 0xc013, PRODUCT: 0xc01a } as const;
export const PRODUCT_DUITNOW_QR = "DUITNOW QR";

function crc16Arc(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function bcd6(sen: number): Uint8Array {
  if (!Number.isInteger(sen) || sen < 0) throw new RangeError(`bad amount ${sen}`);
  const d = String(sen).padStart(12, "0");
  if (d.length > 12) throw new RangeError(`amount ${sen} exceeds 12 digits`);
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) out[i] = (Number(d[i * 2]) << 4) | Number(d[i * 2 + 1]);
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) throw new RangeError(`non-ASCII in ECR field: ${s}`);
    out[i] = c;
  }
  return out;
}

function frame(cmd: number, tlvs: Array<[number, Uint8Array]>): Uint8Array {
  let bodyLen = 0;
  for (const [, v] of tlvs) bodyLen += 4 + v.length;
  if (bodyLen > 0xff) throw new RangeError("TLV payload too long for the 1-byte length field");
  const covered = new Uint8Array(HEADER.length + 4 + bodyLen);
  covered.set(HEADER, 0);
  covered[HEADER.length] = cmd;
  covered[HEADER.length + 3] = bodyLen;
  let i = HEADER.length + 4;
  for (const [tag, v] of tlvs) {
    covered[i++] = (tag >> 8) & 0xff; covered[i++] = tag & 0xff;
    covered[i++] = (v.length >> 8) & 0xff; covered[i++] = v.length & 0xff;
    covered.set(v, i); i += v.length;
  }
  const crc = crc16Arc(covered);
  const out = new Uint8Array(covered.length + 4);
  out[0] = STX; out.set(covered, 1);
  out[covered.length + 1] = (crc >> 8) & 0xff;
  out[covered.length + 2] = crc & 0xff;
  out[covered.length + 3] = ETX;
  return out;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join("");

export function buildSale(amountSen: number, ecrRef: string, duitnowQr = false): Uint8Array {
  const tlvs: Array<[number, Uint8Array]> = [
    [TAG.AMOUNT, bcd6(amountSen)],
    [TAG.ECR_REF, ascii(ecrRef)],
  ];
  if (duitnowQr) tlvs.push([TAG.PRODUCT, ascii(PRODUCT_DUITNOW_QR)]);
  return frame(GhlCmd.SALE, tlvs);
}

export const buildQuery = (amountSen: number, ecrRef: string) =>
  frame(GhlCmd.QUERY, [[TAG.AMOUNT, bcd6(amountSen)], [TAG.ECR_REF, ascii(ecrRef)]]);
export const buildVoid = (amountSen: number, ecrRef: string) =>
  frame(GhlCmd.VOID, [[TAG.AMOUNT, bcd6(amountSen)], [TAG.ECR_REF, ascii(ecrRef)]]);
export const buildSettle = () => frame(GhlCmd.SETTLE, []);

// ── Config ──────────────────────────────────────────────────────────────────
const CFG_KEY = "pos.ghl.terminal.v1";
export type GhlTransport = "auto" | "http" | "tcp";
export type GhlConfig = { enabled: boolean; host: string; port: number; transport: GhlTransport };
const DEFAULTS: GhlConfig = { enabled: false, host: "", port: 33898, transport: "auto" };

export async function loadGhlConfig(): Promise<GhlConfig> {
  try {
    const raw = await AsyncStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GhlConfig>) } : DEFAULTS;
  } catch { return DEFAULTS; }
}
export async function saveGhlConfig(c: GhlConfig) { await AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)); }
export const ghlConfigured = (c: GhlConfig) => c.enabled && !!c.host && c.port > 0;

/** ECR reference: unique per attempt, and short enough for the slip. */
export function newEcrRef(orderNo?: string): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return (orderNo ? orderNo.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) : "POS") + stamp;
}

// ── Transport ───────────────────────────────────────────────────────────────
export type RawReply = { via: "http" | "tcp"; bytes?: Uint8Array; text?: string; status?: number };

async function sendHttp(host: string, port: number, payload: Uint8Array, timeoutMs: number): Promise<RawReply> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: toHex(payload),
      signal: ctl.signal,
    });
    return { via: "http", text: await res.text().catch(() => ""), status: res.status };
  } finally { clearTimeout(t); }
}

function sendTcp(host: string, port: number, payload: Uint8Array, timeoutMs: number): Promise<RawReply> {
  let TcpSocket: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- native; absent on an OTA-only build
    TcpSocket = require("react-native-tcp-socket");
  } catch {
    return Promise.reject(new Error("GHL_TCP_DRIVER_MISSING"));
  }
  return new Promise((resolve, reject) => {
    const chunks: number[] = [];
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock?.destroy(); } catch { /* already closed */ }
      if (err && !chunks.length) reject(err);
      else resolve({ via: "tcp", bytes: Uint8Array.from(chunks) });
    };
    const timer = setTimeout(() => finish(new Error("GHL_TIMEOUT")), timeoutMs);
    let sock: any;
    try {
      sock = TcpSocket.default.createConnection({ host, port }, () => sock.write(payload));
      sock.on("data", (d: any) => {
        chunks.push(...(typeof d === "string" ? Array.from(d as string, (c: string) => c.charCodeAt(0)) : Array.from(d as Uint8Array)));
      });
      sock.on("error", (e: Error) => finish(e));
      sock.on("close", () => finish());
    } catch (e: any) { finish(e); }
  });
}

async function send(cfg: GhlConfig, payload: Uint8Array, timeoutMs: number): Promise<RawReply> {
  if (cfg.transport === "http") return sendHttp(cfg.host, cfg.port, payload, timeoutMs);
  if (cfg.transport === "tcp") return sendTcp(cfg.host, cfg.port, payload, timeoutMs);
  try { return await sendHttp(cfg.host, cfg.port, payload, timeoutMs); }
  catch { return sendTcp(cfg.host, cfg.port, payload, timeoutMs); }
}

// ── Outcome ─────────────────────────────────────────────────────────────────
export type GhlOutcome =
  | { status: "approved"; approvalCode: string; rrn: string; maskedPan: string | null; issuer: string | null; entry: string | null; raw: string }
  | { status: "declined"; reason: string; raw: string }
  /** The terminal's verdict could not be established. NEVER treat as unpaid:
   *  the customer may have been charged. The UI must send staff to the
   *  terminal screen, never offer a silent retry. */
  | { status: "unknown"; reason: string; raw: string };

function rawOf(r: RawReply): string {
  return r.bytes?.length ? toHex(r.bytes) : (r.text ?? "");
}

/**
 * Turn a terminal reply into a verdict.
 *
 * NOT IMPLEMENTED, on purpose. The result codes live in the vendor's Device
 * Interface manual, which we do not have, and no reply has been captured yet.
 * Until one of those exists this returns "unknown" with the raw payload, so a
 * sale can only ever be recorded by a human who has read the terminal.
 *
 * To finish it: run Settings → Terminal Diagnostic against a real transaction,
 * read the captured reply out of the terminal_diagnostics table, and map the
 * result field here. The frame is already structurally decodable — see
 * decodeReply below and packages/shared/src/ghl/frame.ts.
 */
export function interpretSaleResponse(reply: RawReply): GhlOutcome {
  const raw = rawOf(reply);
  return {
    status: "unknown",
    reason: raw
      ? "Terminal replied, but this build cannot yet read GHL result codes — confirm on the terminal screen"
      : "No reply from the terminal — confirm on the terminal screen before charging again",
    raw,
  };
}

/** Structural decode of a framed reply: command, TLVs and CRC validity.
 *  Says nothing about approval — that is interpretSaleResponse's job. */
export function decodeReply(bytes: Uint8Array) {
  if (bytes.length < HEADER.length + 8 || bytes[0] !== STX) return null;
  const covered = bytes.subarray(1, bytes.length - 3);
  const crcOk = crc16Arc(covered) === ((bytes[bytes.length - 3] << 8) | bytes[bytes.length - 2]);
  const tlvs: Array<{ tag: number; value: Uint8Array }> = [];
  const body = covered.subarray(HEADER.length + 4);
  let i = 0;
  while (i + 4 <= body.length) {
    const tag = (body[i] << 8) | body[i + 1];
    const len = (body[i + 2] << 8) | body[i + 3];
    if (i + 4 + len > body.length) break;
    tlvs.push({ tag, value: body.subarray(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return { command: covered[HEADER.length], crcOk, tlvs };
}

/**
 * Charge a card (or DuitNow QR) on the terminal.
 *
 * Sends SALE, then polls QUERY STATUS until a verdict or the deadline. The
 * poll exists because the customer's interaction — insert, PIN, or scanning a
 * QR — takes as long as it takes.
 *
 * Any failure to establish the outcome returns "unknown", never "declined":
 * telling a cashier a payment failed when it may have succeeded is what
 * produces double charges.
 */
export async function chargeOnTerminal(args: {
  amountSen: number;
  orderNo?: string;
  duitnowQr?: boolean;
  timeoutMs?: number;
  onStatus?: (s: string) => void;
}): Promise<GhlOutcome & { ecrRef: string }> {
  const cfg = await loadGhlConfig();
  const ecrRef = newEcrRef(args.orderNo);
  if (!ghlConfigured(cfg)) {
    return { status: "unknown", reason: "Terminal not configured (Settings → GHL Terminal)", raw: "", ecrRef };
  }
  const deadline = Date.now() + (args.timeoutMs ?? 120_000);

  let first: RawReply;
  try {
    first = await send(cfg, buildSale(args.amountSen, ecrRef, args.duitnowQr), 20_000);
  } catch (e: any) {
    return {
      status: "unknown",
      reason: String(e?.message) === "GHL_TCP_DRIVER_MISSING"
        ? "This build cannot reach the terminal over TCP — install the APK, not an OTA update"
        : `Could not reach the terminal: ${String(e?.message ?? e)}`,
      raw: "", ecrRef,
    };
  }

  // The vendor states TCP ECR sends no ACK, so a reply here may already be the
  // final result — or nothing at all, with the verdict only visible by polling.
  const immediate = interpretSaleResponse(first);
  if (immediate.status !== "unknown") return { ...immediate, ecrRef };

  const query = buildQuery(args.amountSen, ecrRef);
  let last: GhlOutcome = immediate;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    args.onStatus?.("Waiting for the terminal…");
    try {
      const verdict = interpretSaleResponse(await send(cfg, query, 10_000));
      if (verdict.status !== "unknown") return { ...verdict, ecrRef };
      last = verdict;
    } catch {
      /* transient — the terminal is mid-interaction; keep polling */
    }
  }
  return { ...last, ecrRef };
}

/** End-of-day settlement. Best-effort: it can also be run from the terminal's
 *  own menu, so a failure here must never block the store close. */
export async function settleOnTerminal(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadGhlConfig();
  if (!ghlConfigured(cfg)) return { ok: true, message: "Terminal not configured — nothing to settle" };
  try {
    const reply = await send(cfg, buildSettle(), 180_000);
    const raw = rawOf(reply);
    return raw
      ? { ok: true, message: "Settlement sent — confirm the slip on the terminal" }
      : { ok: false, message: "No settlement reply — run settlement from the terminal menu" };
  } catch (e: any) {
    return { ok: false, message: `Settlement failed: ${String(e?.message ?? e)}` };
  }
}
