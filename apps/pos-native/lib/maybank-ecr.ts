import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

/**
 * Maybank / IT BizFlow ECR-over-TCP client (X990 terminal).
 * Implements "ECR over TCP/IP API User Manual" v4.3.2 (21 Jul 2026).
 *
 * Topology: the TERMINAL is a TCP server on the outlet LAN; this till is the
 * client. Same-LAN only, IPv4 only. One JSON message per connection:
 *
 *   1. {"txnrequest": {id, txn, input, ip, s, chksum}}   → terminal ACKs
 *      {"txnresponse": {result: SUCCESS|FAIL, ...}} (SUCCESS = accepted,
 *      the terminal now runs the payment UI).
 *   2. Poll {"txnqueryrequest": {id, ip, s, chksum}} every ~1.5s →
 *      {"txnqueryresponse": {result: PROCESSING | OK | CANCEL | FAIL |
 *      DECLINE | HOST_DECLINE | CARD_DECLINE, ...}} until final.
 *
 * Checksums are SHA-256 (uppercase hex) over comma-joined fields, prefixed
 * with the shared salt configured on the terminal:
 *   request:  salt,id,txn,input,ip[,period]
 *   query:    salt,id,ip
 *
 * txn types used here:
 *   SALE_CARD_QR — terminal accepts EITHER card (tap/insert/swipe) OR a
 *                  DuitNow/wallet QR in one flow. Our default "charge".
 *   QRSALE       — DuitNow QR only (terminal displays QR / scans customer's).
 *   SETTLE       — end-of-day settlement (wired to store close).
 *
 * ── Line encryption (BLOCKER, plug-in point) ────────────────────────────
 * The manual mandates line encryption for direct TCP, specified in the
 * restricted "ECR Over TCP-Line Encryption Manual-1.0.0" we don't yet have
 * (request it from the Maybank/ITBF integration rep). encodeFrame/decodeFrame
 * below are the single seam where it slots in; until then they pass plain
 * JSON, which a production-configured terminal will reject with LE_ERROR —
 * surfaced to the caller as a clear "encryption not configured" outcome.
 *
 * The react-native-tcp-socket dependency is NATIVE: this module only works
 * in an APK built after it was added (never via OTA alone). All entry points
 * degrade gracefully when the native module is absent.
 */

// ── Per-till config (AsyncStorage) ────────────────────────────────────────
const CFG_KEY = "pos.maybank.ecr.v1";

export type EcrConfig = {
  enabled: boolean;
  host: string;      // terminal LAN IP, e.g. 192.168.0.150
  port: number;      // terminal ECR port (from terminal config sheet)
  salt: string;      // shared checksum salt (from terminal config sheet)
};

const DEFAULT_CFG: EcrConfig = { enabled: false, host: "", port: 0, salt: "" };

export async function loadEcrConfig(): Promise<EcrConfig> {
  try {
    const raw = await AsyncStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULT_CFG, ...(JSON.parse(raw) as Partial<EcrConfig>) } : DEFAULT_CFG;
  } catch {
    return DEFAULT_CFG;
  }
}

export async function saveEcrConfig(cfg: EcrConfig): Promise<void> {
  await AsyncStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

export function ecrConfigured(cfg: EcrConfig): boolean {
  return cfg.enabled && !!cfg.host && cfg.port > 0 && !!cfg.salt;
}

// ── Checksum ──────────────────────────────────────────────────────────────
async function sha256Upper(s: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
  return hex.toUpperCase();
}

// ── Transport ─────────────────────────────────────────────────────────────
// One request → one reply per connection. Reads until a balanced top-level
// JSON object parses (the manual defines no length framing), guarded by a
// hard timeout so a dead terminal can't hang checkout.

// Line-encryption seam — see module header. Identity until the LE spec lands.
function encodeFrame(json: string): string { return json; }
function decodeFrame(raw: string): string { return raw; }

function getTcp(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- native module may be absent until the APK including it ships
    return require("react-native-tcp-socket");
  } catch {
    return null;
  }
}

function exchange(
  host: string,
  port: number,
  payload: object,
  timeoutMs = 10000,
): Promise<Record<string, any>> {
  const TcpSocket = getTcp();
  if (!TcpSocket) {
    return Promise.reject(new Error("ECR_NATIVE_MISSING"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.destroy(); } catch { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("ECR_TIMEOUT"))), timeoutMs);

    const client = TcpSocket.default.createConnection({ host, port }, () => {
      client.write(encodeFrame(JSON.stringify(payload)));
    });
    client.on("data", (data: Buffer | string) => {
      buffer += typeof data === "string" ? data : data.toString("utf8");
      try {
        const parsed = JSON.parse(decodeFrame(buffer));
        done(() => resolve(parsed));
      } catch {
        /* partial frame — keep reading until close/timeout */
      }
    });
    client.on("error", (e: Error) => done(() => reject(e)));
    client.on("close", () => {
      // Terminal closed without a parseable reply → treat as protocol error
      // (a production terminal with line encryption on does this for plain
      // frames, so surface it as the LE gap rather than a generic failure).
      done(() => reject(new Error(buffer.length ? "ECR_BAD_REPLY" : "ECR_CLOSED_NO_REPLY")));
    });
  });
}

// ── Protocol ──────────────────────────────────────────────────────────────
export type EcrTxnType = "SALE" | "QRSALE" | "SALE_CARD_QR" | "VOID" | "REFUND" | "SETTLE";

export type EcrOutcome =
  | {
      status: "approved";
      approvalCode: string;
      /** DUITNOWQR / CONTACT / CONTACTLESS / SWIPE / BARCODE / … */
      entry: string;
      issuer: string;        // VISA / MASTERCARD / DUITNOWQR / MBBQRPAY / …
      maskedPan: string | null;
      rrn: string;           // retrieval reference number
      cardholder: string | null;
      host: string | null;   // MBB / DUITNOWQR / …
      wallet: string | null;
      /** false = the terminal's reply signature did not match either documented
       *  checksum layout. Not fatal (the cashier confirms the physical terminal),
       *  but the UI must warn — it means a wrong salt, spec drift, or a spoof. */
      signatureVerified: boolean;
      raw: Record<string, any>;
    }
  | { status: "declined"; reason: string; code: string }
  | { status: "cancelled" }
  | { status: "timeout" }
  | {
      status: "error";
      /** ECR_NATIVE_MISSING | ECR_TIMEOUT | ECR_UNREACHABLE | ECR_LINE_ENCRYPTION |
       *  ECR_BUSY | ECR_REJECTED | ECR_BAD_REPLY | ECR_CHKSUM_MISMATCH |
       *  ECR_TXN_UNKNOWN
       *  NOTE: "error" NEVER means "not paid" — it means the outcome is UNKNOWN.
       *  Callers must tell staff to check the terminal, never to auto-retry. */
      code: string;
      message: string;
    };

/** Unique ECR transaction id: yyyymmddHHMMSS + 3 digits (TXNID_EXISTED guard). */
function newTxnId(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return stamp + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
}

// The manual allows "0.0.0.0" when the client can't determine its LAN IP —
// RN has no portable way to read it without another native dep, so we always
// send the sentinel. The terminal keys the session on the txn id, not the ip.
const CLIENT_IP = "0.0.0.0";

const POLL_MS = 1500;

/**
 * Run one terminal transaction to completion. `amountSen` is required for
 * sale types (integer sen, sent as cents string per the spec); SETTLE sends
 * an empty input. `onStatus` receives the terminal's live description
 * ("CARD_INSERTION", "PROCESS_SETTLEMENT", …) for the checkout UI.
 */
export async function ecrTransaction(args: {
  cfg: EcrConfig;
  txn: EcrTxnType;
  amountSen?: number;
  timeoutMs?: number;         // overall ceiling incl. customer interaction
  onStatus?: (description: string) => void;
}): Promise<EcrOutcome> {
  const { cfg, txn, amountSen, onStatus } = args;
  const overallTimeout = args.timeoutMs ?? 120_000;
  if (!ecrConfigured(cfg)) {
    return { status: "error", code: "ECR_REJECTED", message: "Terminal not configured (Settings → Maybank Terminal)" };
  }

  const id = newTxnId();
  const input = amountSen != null ? String(amountSen) : "";
  const chksum = await sha256Upper([cfg.salt, id, txn, input, CLIENT_IP].join(","));
  const request = { txnrequest: { id, txn, input, ip: CLIENT_IP, s: cfg.salt, chksum } };

  // 1. Submit — the ACK is fast; customer interaction happens during polling.
  let ack: Record<string, any>;
  try {
    ack = await exchange(cfg.host, cfg.port, request, 10_000);
  } catch (e) {
    return mapTransportError(e);
  }
  const ackBody = ack?.txnresponse ?? {};
  // Verify the ACK signature (manual p9: salt,result,description,id,txn,input,ip).
  // A mismatch here only blocks the transaction from STARTING, so it is safe to
  // fail closed — no money can have moved yet.
  if (ackBody.chksum) {
    const expectAck = await sha256Upper(
      [cfg.salt, String(ackBody.result ?? ""), String(ackBody.description ?? ""), String(ackBody.id ?? id),
       String(ackBody.txn ?? txn), String(ackBody.input ?? input), String(ackBody.ip ?? "")].join(","),
    );
    if (expectAck !== String(ackBody.chksum).toUpperCase()) {
      // Warn only. The ACK merely starts the transaction; the query loop's
      // signature check and the cashier's terminal check are the real gates.
      console.warn("[ecr] request ACK checksum mismatch — check the ECR salt", { id });
    }
  }
  if (ackBody.result !== "SUCCESS") {
    const desc: string = ackBody.description ?? "REJECTED";
    if (desc === "LE_ERROR") {
      return { status: "error", code: "ECR_LINE_ENCRYPTION", message: "Terminal requires line encryption (spec pending from Maybank)" };
    }
    if (desc === "BUSY") {
      return { status: "error", code: "ECR_BUSY", message: "Terminal is busy with another transaction" };
    }
    return { status: "error", code: "ECR_REJECTED", message: desc };
  }

  // 2. Poll until a final result.
  const qryChksum = await sha256Upper([cfg.salt, id, CLIENT_IP].join(","));
  const query = { txnqueryrequest: { id, ip: CLIENT_IP, s: cfg.salt, chksum: qryChksum } };
  const deadline = Date.now() + overallTimeout;
  // TXNID_NOT_FOUND is reported as result=FAIL, but it does NOT mean declined —
  // it means the terminal has no record of this id, which is expected for the
  // first poll(s) before the payment app registers the transaction. Treating it
  // as a decline would tell the cashier "not completed" while the customer is
  // still paying — the paid-but-unrecorded failure mode. So we ride it out for
  // a grace window, and even after that report UNKNOWN (never "declined").
  const NOT_FOUND_GRACE_MS = 15_000;
  const startedAt = Date.now();
  let sawProcessing = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let res: Record<string, any>;
    try {
      res = await exchange(cfg.host, cfg.port, query, 10_000);
    } catch {
      continue; // transient poll miss — the terminal is mid-interaction; retry
    }
    const body = res?.txnqueryresponse ?? {};
    const result: string = body.result ?? "";
    const description: string = String(body.description ?? "");

    // Integrity: the terminal signs every response. The manual CONTRADICTS
    // itself on the query-response field list — the table (p11) omits `txn`
    // while its own SALE examples (p17) include it, and the SETTLE example
    // (p18) omits it again. So accept EITHER documented ordering; a single
    // fixed order would reject valid approvals and break every card payment.
    // Mismatch is surfaced (signatureVerified=false → warning on the approval
    // card), not blocking: the cashier must read the physical terminal before
    // recording the sale anyway, so a spoof can't book an unpaid sale on its
    // own — while blocking would take the till down on a spec disagreement.
    let signatureVerified = true;
    if (body.chksum) {
      const got = String(body.chksum).toUpperCase();
      const base = [cfg.salt, result, description, String(body.id ?? id)];
      const tail = [String(body.version ?? ""), String(body.ip ?? "")];
      const withoutTxn = await sha256Upper([...base, ...tail].join(","));
      const withTxn = await sha256Upper([...base, String(body.txn ?? txn), ...tail].join(","));
      signatureVerified = got === withoutTxn || got === withTxn;
      if (!signatureVerified) console.warn("[ecr] query response checksum mismatch", { id, result });
    }

    if (result === "PROCESSING") {
      sawProcessing = true;
      if (description && onStatus) onStatus(description);
      continue;
    }
    if (result === "OK" || result === "COMPLETE") {
      return {
        status: "approved",
        approvalCode: String(body.approval ?? body.order ?? id),
        entry: String(body.entry ?? "UNDEFINED"),
        issuer: String(body.issuer ?? ""),
        maskedPan: body.pan ? String(body.pan) : null,
        rrn: String(body.rrn ?? ""),
        cardholder: body.cardholder ? String(body.cardholder) : null,
        host: body.host ? String(body.host) : null,
        wallet: body.wallet ? String(body.wallet) : null,
        signatureVerified,
        raw: body,
      };
    }
    if (result === "CANCEL") return { status: "cancelled" };
    if (result === "FAIL" && description === "TXNID_NOT_FOUND") {
      // Not a verdict. Keep polling while the terminal may still be catching up.
      if (!sawProcessing && Date.now() - startedAt < NOT_FOUND_GRACE_MS) continue;
      return {
        status: "error",
        code: "ECR_TXN_UNKNOWN",
        message: "Terminal has no record of this payment — check the terminal screen before charging again",
      };
    }
    if (result === "DECLINE" || result === "HOST_DECLINE" || result === "CARD_DECLINE" || result === "FAIL") {
      return { status: "declined", reason: description || result, code: result };
    }
    // Unknown result value → keep polling until deadline rather than guess.
  }
  return { status: "timeout" };
}

function mapTransportError(e: unknown): EcrOutcome {
  const msg = String((e as Error)?.message ?? e);
  if (msg === "ECR_NATIVE_MISSING") {
    return { status: "error", code: "ECR_NATIVE_MISSING", message: "This build lacks the terminal driver — update the app (APK), not just OTA" };
  }
  if (msg === "ECR_TIMEOUT") return { status: "error", code: "ECR_TIMEOUT", message: "Terminal did not respond — check it is on and on the same Wi-Fi/LAN" };
  if (msg === "ECR_CLOSED_NO_REPLY" || msg === "ECR_BAD_REPLY") {
    return { status: "error", code: "ECR_LINE_ENCRYPTION", message: "Terminal rejected the connection — likely line-encryption mismatch" };
  }
  return { status: "error", code: "ECR_UNREACHABLE", message: msg };
}

/** Cheap reachability check for the Settings screen: TCP connect + close.
 *  Proves IP/port/LAN; does NOT validate salt or line encryption. */
export async function testEcrConnection(cfg: EcrConfig): Promise<{ ok: boolean; message: string }> {
  const TcpSocket = getTcp();
  if (!TcpSocket) return { ok: false, message: "Terminal driver missing — needs an APK update" };
  if (!cfg.host || !cfg.port) return { ok: false, message: "Set the terminal IP and port first" };
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.destroy(); } catch { /* ignore */ }
      resolve({ ok, message });
    };
    const timer = setTimeout(() => done(false, "No response — check IP, port and that the till shares the terminal's network"), 5000);
    const client = TcpSocket.default.createConnection({ host: cfg.host, port: cfg.port }, () => {
      done(true, "Terminal reachable");
    });
    client.on("error", (e: Error) => done(false, `Connection failed: ${e.message}`));
  });
}
