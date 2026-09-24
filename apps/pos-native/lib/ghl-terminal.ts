/**
 * GHL / NTT Data ADAPTIS card terminal — POS client.
 *
 * Ported from the working integration in celsiuscoffee/gosame-ops, which is
 * live-tested against the same hardware. Two things there are worth repeating
 * because they were not obvious from the vendor's documentation:
 *
 *   1. The transport is an ordinary HTTP POST, not a socket. The framed
 *      message goes in the body as hex and the reply comes back the same way
 *      (NTT DATA's own Postman example). So this needs no native module and
 *      ships over the air — the earlier assumption that a raw TCP socket was
 *      required, and therefore a new APK, was wrong.
 *   2. The eTSK encryption described in spec 2.9.26 section 4.2 applies to the
 *      raw socket path. Over HTTP the terminal accepts the plain framed
 *      message, so the key exchange is not a blocker for this route.
 *
 * The codec and command builders live in lib/ecr/ and are copied verbatim from
 * that repo, where they are verified against the spec's own samples. Keep them
 * in step rather than editing them here.
 *
 * Two rules, carried over deliberately:
 *   • Never assume a failure. A lost reply is not a failed payment — ask the
 *     terminal what happened before anyone concludes anything.
 *   • Never charge twice. Every attempt carries our own invoice reference so
 *     a status query or a void can find it again.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode, STATUS, statusText, toHex, fromHex, type Message } from "./ecr/device-interface";
import { saleRequest, queryRequest, voidRequest, settleRequest, DEFAULT_OPTIONS, type Flavour, type Method } from "./ecr/commands";

const CFG_KEY = "pos.ghl.terminal.v1";

/** Retained for the Settings screen. HTTP is the real transport; the socket
 *  path is not implemented because it would require the eTSK key exchange. */
export type GhlTransport = "auto" | "http" | "tcp";

export type GhlConfig = {
  enabled: boolean;
  host: string;
  port: number;
  transport: GhlTransport;
  /** "direct" is the ADAPTIS/PayHereDirect on our counters; "ecr" is the
   *  other build NTT Data ship, which answers status queries differently. */
  flavour: Flavour;
  /** Test mode: the terminal address points at the ECR simulator rather than
   *  real hardware, so no money moves. Approvals are still real *replies*, and
   *  without this flag they are indistinguishable from a genuine charge — they
   *  would land in the receipts, the Z-report and the payment QA sweep as
   *  revenue nobody paid. Defaults ON so the mistake fails in the harmless
   *  direction: a real sale mislabelled as a test is noticed immediately,
   *  a test sale booked as real is not. */
  testMode: boolean;
  /** NTT Data's DuitNow product code. QRC returns the QR as a string, which
   *  is what we want; DQR returns an image. A wrong code is not rejected —
   *  the terminal simply sits for ~15s and cancels. */
  qrProductId: string;
  saleTimeoutMs: number;
  quickTimeoutMs: number;
  pendingTries: number;
  pendingGapMs: number;
};

const DEFAULTS: GhlConfig = {
  enabled: false, host: "", port: 33898, transport: "http", testMode: true,
  flavour: "direct", qrProductId: "DUITNOWQRC",
  saleTimeoutMs: 90_000, quickTimeoutMs: 15_000,
  pendingTries: 40, pendingGapMs: 3_000,
};

export async function loadGhlConfig(): Promise<GhlConfig> {
  try {
    const raw = await AsyncStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GhlConfig>) } : DEFAULTS;
  } catch { return DEFAULTS; }
}
export async function saveGhlConfig(c: GhlConfig) { await AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)); }
export const ghlConfigured = (c: GhlConfig) => c.enabled && !!c.host && c.port > 0;

/** Our own reference, unique per attempt: it goes on the terminal slip and is
 *  how a status query or void finds the transaction again. */
export function newEcrRef(orderNo?: string): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return (orderNo ? orderNo.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) : "POS") + stamp;
}

export type GhlOutcome =
  | { status: "approved"; approvalCode: string; rrn: string; maskedPan: string | null; issuer: string | null; entry: string | null; raw: string; simulated?: boolean }
  | { status: "declined"; reason: string; raw: string }
  /** The verdict could not be established. NEVER treat as unpaid — the guest
   *  may have been charged. Send staff to the terminal; never auto-retry. */
  | { status: "unknown"; reason: string; raw: string };

class TerminalBusy extends Error {}
class TerminalLost extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One message to the terminal and its reply, over HTTP. */
async function talk(cfg: GhlConfig, frame: number[], readTimeoutMs: number): Promise<Message> {
  if (!cfg.host) throw new TerminalLost("No terminal address in settings");
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), readTimeoutMs);
  let body: string;
  try {
    const res = await fetch(`http://${cfg.host}:${cfg.port}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: toHex(frame),
      signal: stop.signal,
    });
    body = (await res.text()).trim();
    // BUSY means the terminal still has something on its screen. Nothing was
    // taken, so say that plainly rather than implying a lost payment.
    if (res.status === 400 && /busy/i.test(body)) {
      throw new TerminalBusy("The terminal is mid-transaction — clear its screen and try again");
    }
    if (!res.ok) throw new TerminalLost(`The terminal answered ${res.status}${body ? `: ${body.slice(0, 60)}` : ""}`);
  } catch (e) {
    if (e instanceof TerminalBusy) throw e;
    throw new TerminalLost(e instanceof TerminalLost ? e.message : String((e as Error)?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
  if (!body) throw new TerminalLost("The terminal did not answer");
  return decode(fromHex(body));
}

function approvedFrom(m: Message, raw: string, simulated = false): GhlOutcome {
  return {
    status: "approved",
    simulated,
    approvalCode: m.text("approvalCode")?.trim() || "",
    rrn: m.text("rrn")?.trim() || "",
    maskedPan: m.text("maskedPan")?.trim() || null,
    issuer: m.text("productBrand")?.trim() || null,
    entry: m.text("entryModeText")?.trim() || null,
    raw,
  };
}

/** What a status query means. The two builds answer differently. */
function readStatus(cfg: GhlConfig, m: Message): "approved" | "pending" | "gone" | "declined" {
  if (cfg.flavour === "ecr") {
    const original = m.text("originalStatus")?.trim().toUpperCase();
    if (m.status !== STATUS.ok) return m.status === STATUS.noTransaction ? "gone" : "pending";
    if (original === "00") return "approved";
    if (original === "EA" || !original) return "pending";
    return "declined";
  }
  // "direct" answers as if it were the sale itself
  if (m.status === STATUS.ok) return "approved";
  if (m.status === STATUS.pending) return "pending";
  if (m.status === STATUS.noTransaction) return "gone";
  return "declined";
}

/** A QR payment sits pending until the guest pays or gives up. */
async function pollPending(cfg: GhlConfig, ringgit: number, ref: string, say: (s: string) => void): Promise<GhlOutcome> {
  for (let i = 0; i < cfg.pendingTries; i++) {
    await sleep(cfg.pendingGapMs);
    let m: Message;
    try {
      m = await talk(cfg, queryRequest(ringgit, ref, cfg.flavour), cfg.quickTimeoutMs);
    } catch {
      continue; // a check that did not get through says nothing either way
    }
    const what = readStatus(cfg, m);
    if (what === "approved") return approvedFrom(m, "", cfg.testMode);
    if (what === "declined") {
      return { status: "declined", reason: m.text("originalMessage")?.trim() || statusText(m.status), raw: "" };
    }
    if (what === "gone") return { status: "declined", reason: "The guest did not pay — nothing was charged", raw: "" };
    say(`Waiting for the guest to pay (${i + 1})`);
  }
  return { status: "unknown", reason: "The guest has not finished paying. Check the terminal before charging again.", raw: "" };
}

/** A reply was lost. The payment may well have gone through, so ask. */
async function resolveLost(cfg: GhlConfig, ringgit: number, ref: string, why: string, say: (s: string) => void): Promise<GhlOutcome> {
  say("Lost the terminal — checking what happened");
  for (let i = 0; i < 3; i++) {
    try {
      const m = await talk(cfg, queryRequest(ringgit, ref, cfg.flavour), cfg.quickTimeoutMs);
      const what = readStatus(cfg, m);
      if (what === "approved") return approvedFrom(m, "", cfg.testMode);
      if (what === "gone") return { status: "declined", reason: "Nothing was charged", raw: "" };
      if (what === "declined") return { status: "declined", reason: statusText(m.status), raw: "" };
    } catch {
      await sleep(1500);
    }
  }
  return {
    status: "unknown",
    reason: `Lost contact with the terminal (${why}). Check the terminal screen before charging again.`,
    raw: "",
  };
}

async function settleOutcome(cfg: GhlConfig, m: Message, ringgit: number, ref: string, say: (s: string) => void): Promise<GhlOutcome> {
  if (m.status === STATUS.ok) return approvedFrom(m, "", cfg.testMode);
  if (m.status === STATUS.pending) { say("Waiting for the guest to pay"); return pollPending(cfg, ringgit, ref, say); }
  if (m.status === STATUS.cancelled || m.status === STATUS.deviceTimeout) {
    return { status: "declined", reason: statusText(m.status), raw: "" };
  }
  return { status: "declined", reason: statusText(m.status), raw: "" };
}

/** Charge the guest: card, their own wallet code, or a DuitNow QR on screen. */
export async function chargeOnTerminal(args: {
  amountSen: number;
  orderNo?: string;
  duitnowQr?: boolean;
  method?: Method;
  cashierId?: string;
  onStatus?: (s: string) => void;
}): Promise<GhlOutcome & { ecrRef: string }> {
  const cfg = await loadGhlConfig();
  const ecrRef = newEcrRef(args.orderNo);
  const say = args.onStatus ?? (() => {});
  if (!ghlConfigured(cfg)) {
    return { status: "unknown", reason: "Terminal not configured (Settings → GHL Terminal)", raw: "", ecrRef };
  }
  const ringgit = args.amountSen / 100;
  const method: Method = args.method ?? (args.duitnowQr ? "qr_pay" : "card");
  const frame = saleRequest({
    ringgit, ecrInvoice: ecrRef, method, cashierId: args.cashierId,
    options: { ...DEFAULT_OPTIONS, flavour: cfg.flavour, qrProductId: cfg.qrProductId },
  });

  say(method === "qr_pay" ? "Showing the QR on the terminal" : method === "ewallet" ? "Ask the guest to show their code" : "Ask the guest to tap or insert");

  let m: Message;
  try {
    m = await talk(cfg, frame, cfg.saleTimeoutMs);
  } catch (e) {
    // A busy terminal never took the message: nothing was attempted, so do
    // not send the cashier hunting for a payment that does not exist.
    if (e instanceof TerminalBusy) return { status: "declined", reason: (e as Error).message, raw: "", ecrRef };
    return { ...(await resolveLost(cfg, ringgit, ecrRef, String((e as Error)?.message ?? e), say)), ecrRef };
  }
  return { ...(await settleOutcome(cfg, m, ringgit, ecrRef, say)), ecrRef };
}

/** Void a transaction we still hold the reference for. */
export async function voidOnTerminal(amountSen: number, ecrRef: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadGhlConfig();
  if (!ghlConfigured(cfg)) return { ok: false, message: "Terminal not configured" };
  try {
    const m = await talk(cfg, voidRequest(amountSen / 100, ecrRef), cfg.quickTimeoutMs);
    return m.status === STATUS.ok
      ? { ok: true, message: "Voided" }
      : { ok: false, message: statusText(m.status) };
  } catch (e) {
    return { ok: false, message: `Could not void: ${String((e as Error)?.message ?? e)}` };
  }
}

/** End-of-day settlement. Best-effort: it can also be run from the terminal's
 *  own menu, so a failure here must never block the store close. */
export async function settleOnTerminal(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadGhlConfig();
  if (!ghlConfigured(cfg)) return { ok: true, message: "Terminal not configured — nothing to settle" };
  try {
    const m = await talk(cfg, settleRequest(), 180_000);
    if (m.status === STATUS.ok) return { ok: true, message: "Settlement complete" };
    if (m.status === STATUS.batchEmpty) return { ok: true, message: "Nothing to settle" };
    return { ok: false, message: statusText(m.status) };
  } catch (e) {
    return { ok: false, message: `Settlement failed: ${String((e as Error)?.message ?? e)}` };
  }
}
