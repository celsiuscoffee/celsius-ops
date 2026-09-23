/**
 * GHL ADAPTIS terminal probe — runs FROM THE TILL, which is already on the
 * outlet LAN the terminal sits on.
 *
 * Why this exists: the terminal answers only on the shop network, and no
 * developer machine is on it. Rather than ask someone to run commands on a
 * laptop, the till does the probing itself and files the result to Supabase,
 * where it can be read remotely.
 *
 * Deliberately HTTP-only (`fetch`), for two reasons:
 *   1. the terminal advertises itself as http://<ip> on its home screen and
 *      the vendor pointed us at Postman, so the PayHereDirect interface is
 *      very likely HTTP rather than the raw socket the sample frames imply;
 *   2. `fetch` needs no native module, so this ships over the air. A raw-TCP
 *      probe would need react-native-tcp-socket and therefore a new APK.
 *
 * NOTHING HERE CAN TAKE A PAYMENT. Every request is either a plain GET or a
 * QUERY STATUS (command 0xE3) for a reference that does not exist. SALE is
 * not implemented in this file on purpose — a diagnostic must never be able
 * to charge a customer by accident.
 */
import { supabase } from "./supabase";

/** Default from the terminal's own home screen; overridable per till. */
export const DEFAULT_TERMINAL_HOST = "192.168.50.176";
export const DEFAULT_TERMINAL_PORT = 33898;

/** Pre-built QUERY STATUS frame (ref TESTPROBE001, RM0.10) — the CRC is
 *  baked in, and matches packages/shared/src/ghl/frame.ts, which is tested
 *  against the vendor's published samples. Safe: the reference is fictional. */
const QUERY_STATUS_HEX =
  "02000C010B01E300001AC0010006000000000010C013000C5445535450524F4245303031F13903";

export type ProbeStep = {
  label: string;
  url: string;
  method: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyPreview?: string;
  bodyBytes?: number;
  error?: string;
  ms: number;
};

export type ProbeReport = {
  host: string;
  port: number;
  startedAt: string;
  steps: ProbeStep[];
  /** Plain-language read of what the steps imply, for the person holding the till. */
  verdict: string;
};

const TIMEOUT_MS = 8000;

async function attempt(
  label: string,
  url: string,
  init: RequestInit & { method: string },
): Promise<ProbeStep> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    const headers: Record<string, string> = {};
    // RN's Headers is iterable via forEach.
    res.headers?.forEach?.((v: string, k: string) => { headers[k] = v; });
    return {
      label, url, method: init.method, ok: true,
      status: res.status, statusText: res.statusText,
      headers,
      bodyPreview: text.slice(0, 1500),
      bodyBytes: text.length,
      ms: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      label, url, method: init.method, ok: false,
      error: String(e?.message ?? e),
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run the full safe sweep. `onStep` streams progress to the UI. */
export async function probeTerminal(
  host = DEFAULT_TERMINAL_HOST,
  port = DEFAULT_TERMINAL_PORT,
  onStep?: (s: ProbeStep) => void,
): Promise<ProbeReport> {
  const base = `http://${host}:${port}`;
  const steps: ProbeStep[] = [];
  const push = (s: ProbeStep) => { steps.push(s); onStep?.(s); };

  // 1. Is anything speaking HTTP at all, and on what paths?
  for (const path of ["/", "/api", "/ecr", "/pos", "/payment", "/PayHereDirect"]) {
    push(await attempt(`GET ${path}`, base + path, { method: "GET" }));
  }

  // 2. If it is HTTP, how does it want the message? Try the plausible carriers
  //    with a QUERY STATUS that cannot move money.
  const carriers: Array<[string, string, string]> = [
    ["POST / (hex text)", "/", QUERY_STATUS_HEX],
    ["POST / (json hex)", "/", JSON.stringify({ message: QUERY_STATUS_HEX })],
    ["POST /api (hex text)", "/api", QUERY_STATUS_HEX],
  ];
  for (const [label, path, body] of carriers) {
    push(await attempt(label, base + path, {
      method: "POST",
      headers: { "Content-Type": body.startsWith("{") ? "application/json" : "text/plain" },
      body,
    }));
  }

  return { host, port, startedAt: new Date().toISOString(), steps, verdict: verdictFor(steps) };
}

function verdictFor(steps: ProbeStep[]): string {
  const answered = steps.filter((s) => s.ok);
  if (answered.length === 0) {
    const refused = steps.some((s) => /refus/i.test(s.error ?? ""));
    return refused
      ? "Nothing is listening on that port. Check the port in the terminal's SETTINGS menu, and whether ECR/POS mode has to be switched on."
      : "No reply at all — likely the wrong IP or port, or the till is on a different Wi-Fi from the terminal.";
  }
  const useful = answered.find((s) => (s.status ?? 0) < 500 && (s.bodyBytes ?? 0) > 0);
  return useful
    ? `HTTP confirmed — ${useful.label} answered ${useful.status}. The response body tells us how the API is shaped.`
    : `Something answered on HTTP (${answered.length} of ${steps.length} requests) but returned no body. The status codes still narrow it down.`;
}

/** File the report so it can be read remotely. Failure to save never fails the
 *  probe — the on-screen result is still there to photograph. */
export async function saveProbeReport(
  report: ProbeReport,
  outletId: string | null,
): Promise<{ saved: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from("terminal_diagnostics")
      .insert({ outlet_id: outletId, host: report.host, port: report.port, report });
    return error ? { saved: false, error: error.message } : { saved: true };
  } catch (e: any) {
    return { saved: false, error: String(e?.message ?? e) };
  }
}
