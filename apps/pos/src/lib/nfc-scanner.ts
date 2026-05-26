"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web NFC hook for the customer-display.
 *
 * Hardware target: SUNMI D3 second display with NFC tap-on-glass.
 * Browser availability: Chrome on Android only (incl. SUNMI's WebView).
 * On unsupported browsers the hook reports { available: false } and
 * does nothing — caller falls back to the on-screen phone numpad.
 *
 * Accepted NDEF payload shapes (most → least specific):
 *   • URL with /m/<id>          → memberId or phone, whichever pattern fits
 *   • URL with ?member=<id>     → memberId
 *   • URL with ?phone=<number>  → phone
 *   • Text record matching a MY phone (10–13 digits, optional + / 0 / 60) → phone
 *   • Text record looking like a memberId (member-… prefix) → memberId
 *   • Anything else → ignored (raw exposed via lastRead.raw for debug)
 *
 * The hook keeps the scanner alive across re-renders and silently
 * re-arms after each read so the same tag can be re-tapped without
 * the operator restarting anything.
 */

export type NfcResult =
  | { kind: "phone"; value: string; raw: string }
  | { kind: "memberId"; value: string; raw: string }
  | { kind: "unknown"; raw: string };

type State = {
  /** Web NFC is available in this browser. */
  available: boolean;
  /** Scanner is currently armed and listening for taps. */
  scanning: boolean;
  /** The most recent parsed read, regardless of kind. */
  lastRead: NfcResult | null;
  /** Last error from start() — typically permission denied or unsupported. */
  error: string | null;
};

// Minimal subset of the Web NFC DOM types we touch — keeps the file
// self-contained without bringing in @types/web-nfc.
type NDEFRecord = {
  recordType: string;
  mediaType?: string;
  encoding?: string;
  lang?: string;
  data?: ArrayBuffer | DataView | Uint8Array;
};
type NDEFMessage = { records: NDEFRecord[] };
type NDEFReadingEvent = { message: NDEFMessage; serialNumber: string };
type NDEFReaderInstance = {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((e: NDEFReadingEvent) => void) | null;
  onreadingerror: ((e: Event) => void) | null;
};
type NDEFReaderCtor = new () => NDEFReaderInstance;

function getNDEFReader(): NDEFReaderCtor | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader) ?? null;
}

// ─── NDEF record decoder ─────────────────────────────────────
function bufToString(data: ArrayBuffer | DataView | Uint8Array | undefined, encoding = "utf-8"): string {
  if (!data) return "";
  // Normalise to a Uint8Array view so TextDecoder gets a consistent BufferSource.
  let view: Uint8Array;
  if (data instanceof Uint8Array) {
    view = data;
  } else if (data instanceof ArrayBuffer) {
    view = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return "";
  }
  try {
    return new TextDecoder(encoding).decode(view);
  } catch {
    return new TextDecoder().decode(view);
  }
}

function looksLikeMyPhone(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "");
  // MY mobile numbers are 10-12 digits (e.g. 0123456789, 60123456789).
  if (digits.length < 9 || digits.length > 13) return false;
  return /^\+?(60|0)?\d{9,11}$/.test(s.trim());
}

function looksLikeMemberId(s: string): boolean {
  return /^member-[A-Za-z0-9_-]+$/.test(s.trim());
}

function parseUrl(raw: string): NfcResult | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // /m/<id> path segment
  const pathMatch = url.pathname.match(/\/m\/([^/]+)/);
  if (pathMatch) {
    const id = decodeURIComponent(pathMatch[1]);
    if (looksLikeMemberId(id)) return { kind: "memberId", value: id, raw };
    if (looksLikeMyPhone(id)) return { kind: "phone", value: id, raw };
  }
  const memberQ = url.searchParams.get("member") ?? url.searchParams.get("member_id");
  if (memberQ && looksLikeMemberId(memberQ)) {
    return { kind: "memberId", value: memberQ, raw };
  }
  const phoneQ = url.searchParams.get("phone");
  if (phoneQ && looksLikeMyPhone(phoneQ)) {
    return { kind: "phone", value: phoneQ, raw };
  }
  return null;
}

function parseRecord(rec: NDEFRecord): NfcResult | null {
  if (rec.recordType === "url" || rec.recordType === "absolute-url") {
    const raw = bufToString(rec.data, "utf-8");
    return parseUrl(raw);
  }
  if (rec.recordType === "text") {
    const raw = bufToString(rec.data, rec.encoding ?? "utf-8");
    if (looksLikeMyPhone(raw)) return { kind: "phone", value: raw.trim(), raw };
    if (looksLikeMemberId(raw)) return { kind: "memberId", value: raw.trim(), raw };
    // Maybe the text is itself a URL.
    if (/^https?:\/\//i.test(raw.trim())) return parseUrl(raw.trim());
    return { kind: "unknown", raw };
  }
  if (rec.recordType === "mime" && rec.mediaType === "application/vnd.celsius.member") {
    const raw = bufToString(rec.data, "utf-8");
    if (looksLikeMemberId(raw)) return { kind: "memberId", value: raw.trim(), raw };
    if (looksLikeMyPhone(raw)) return { kind: "phone", value: raw.trim(), raw };
    return { kind: "unknown", raw };
  }
  return null;
}

function parseMessage(msg: NDEFMessage): NfcResult {
  for (const rec of msg.records ?? []) {
    const parsed = parseRecord(rec);
    if (parsed && parsed.kind !== "unknown") return parsed;
  }
  // No specific match — return the first decoded raw payload for debug.
  for (const rec of msg.records ?? []) {
    const raw = rec.recordType === "text" || rec.recordType === "url" || rec.recordType === "absolute-url"
      ? bufToString(rec.data, rec.encoding ?? "utf-8")
      : "";
    if (raw) return { kind: "unknown", raw };
  }
  return { kind: "unknown", raw: "" };
}

// ─── Hook ────────────────────────────────────────────────────
export function useNfcScanner(opts: {
  enabled: boolean;
  onRead?: (r: NfcResult) => void;
}): State & { start: () => Promise<void>; stop: () => void } {
  const { enabled, onRead } = opts;
  const [state, setState] = useState<State>(() => ({
    available: !!getNDEFReader(),
    scanning: false,
    lastRead: null,
    error: null,
  }));
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<NDEFReaderInstance | null>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => { onReadRef.current = onRead; }, [onRead]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    readerRef.current = null;
    setState((s) => ({ ...s, scanning: false }));
  }, []);

  const start = useCallback(async () => {
    const Ctor = getNDEFReader();
    if (!Ctor) {
      setState((s) => ({ ...s, available: false, error: "Web NFC not supported" }));
      return;
    }
    if (abortRef.current) return; // already scanning
    const reader = new Ctor();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    readerRef.current = reader;
    reader.onreading = (e: NDEFReadingEvent) => {
      const parsed = parseMessage(e.message);
      setState((s) => ({ ...s, lastRead: parsed }));
      // Fire callback after state update so consumers can react.
      onReadRef.current?.(parsed);
    };
    reader.onreadingerror = () => {
      setState((s) => ({ ...s, error: "Tag read error — try again" }));
    };
    try {
      await reader.scan({ signal: ctrl.signal });
      setState((s) => ({ ...s, scanning: true, error: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "NFC scan failed";
      setState((s) => ({ ...s, scanning: false, error: msg }));
      abortRef.current = null;
      readerRef.current = null;
    }
  }, []);

  // Auto-manage based on `enabled` flag. Re-arms when consumer toggles
  // enabled true (e.g. member signs out).
  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    if (state.available && !state.scanning && !abortRef.current) {
      void start();
    }
    // We intentionally don't stop on unmount of the consumer until the
    // parent component unmounts — the scanner is a long-lived resource.
  }, [enabled, state.available, state.scanning, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { ...state, start, stop };
}
