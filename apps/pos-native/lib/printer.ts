import SunmiPrinter from "@/modules/sunmi-printer";
import {
  formatReceipt,
  formatKitchenDocket,
  stationsForOrder,
  type OutletInfo,
  type ReceiptConfig,
  type ReceiptOrder,
  type DocketOrder,
} from "./receipt-format";
import { routeKitchenDockets, routeReceipt } from "./network-printer";

/**
 * High-level print dispatch for the native register — the native port of
 * apps/pos/src/lib/sunmi-printer.ts printReceipt80mm / printKitchenDocket80mm.
 *
 * Everything routes through the SUNMI built-in 80mm head (the D3's only
 * printer). When the native module isn't present (dev / Expo Go) these
 * become safe no-ops so checkout never breaks — callers also wrap in
 * try/catch and fire-and-forget.
 */

export function printerAvailable(): boolean {
  return SunmiPrinter != null;
}

/**
 * Throw when the printer can't physically print, so callers DON'T mark
 * the order as printed (it stays unprinted and reprints on the next
 * catch-up once the head is fixed). Without this, the SUNMI LineApi
 * accepts a job and returns success even with paper out / cover open /
 * disconnected — the order gets stamped printed but nothing comes out
 * (the silent failure behind "pickup orders not printing").
 *
 * Defensive: if we can't read the status, we PROCEED (don't block normal
 * printing on an unknown state) — we only abort on a clearly bad one.
 */
// Only unambiguous hardware faults — NORMAL/READY never contain these, so
// we won't false-block a healthy head. Disconnection is handled separately
// via the connected flag.
const PRINTER_FAULT = /out.?paper|no.?paper|paper.?out|paper.?empty|lack.?paper|cover|overheat|jam/i;

export async function ensurePrinterReady(): Promise<void> {
  if (!SunmiPrinter) return; // dev / Expo Go no-op
  let st: { connected?: boolean; status?: string; paper?: string } | null = null;
  try {
    st = await SunmiPrinter.getStatus();
  } catch {
    return; // status unreadable — let the print attempt proceed
  }
  if (st?.connected === false) {
    throw new Error("printer-fault: not connected");
  }
  const probe = `${st?.status ?? ""} ${st?.paper ?? ""}`;
  if (PRINTER_FAULT.test(probe)) {
    throw new Error(`printer-fault: ${st?.status ?? "unknown"}`);
  }
}

/** True the first time it's called within a 60s window — used to throttle
 *  the on-screen "printer needs attention" alert so a paper-out doesn't
 *  spawn a modal per order. */
let _lastFaultAlert = 0;
export function shouldAlertPrinterFault(): boolean {
  const now = Date.now();
  if (now - _lastFaultAlert < 60_000) return false;
  _lastFaultAlert = now;
  return true;
}

/** Was this error raised by ensurePrinterReady (vs a generic failure)? */
export function isPrinterFault(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("printer-fault");
}

export async function getPrinterStatus() {
  if (!SunmiPrinter) return { connected: false, status: "module-unavailable" };
  try {
    return await SunmiPrinter.getStatus();
  } catch (e: any) {
    return { connected: false, status: `error: ${e?.message ?? e}` };
  }
}

/** Manual re-init (Settings screen "reconnect"). */
export async function reconnectPrinter() {
  if (!SunmiPrinter) return { connected: false };
  try {
    return await SunmiPrinter.printerInit();
  } catch {
    return { connected: false };
  }
}

/** Settings screen "Test print" — proves the head + paper are alive. */
export async function testPrint(): Promise<boolean> {
  if (!SunmiPrinter) return false;
  try {
    await SunmiPrinter.printFormattedReceipt({
      header: "Celsius Coffee\nPrinter Test",
      body:
        "================================\n" +
        "Order: TEST-0001\n" +
        "Time: " + new Date().toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true }) + "\n" +
        "================================\n" +
        "1x Test Latte                  RM12.00\n" +
        "--------------------------------------\n" +
        "TOTAL                          RM12.00\n" +
        "================================",
      footer: "\nIf you can read this,\nthe printer is working!\n",
      showLogo: true,
    });
    return true;
  } catch (e: any) {
    console.error("[printer] testPrint failed:", e?.message ?? e);
    return false;
  }
}

export async function printReceipt80mm(
  order: ReceiptOrder,
  outlet: OutletInfo | string,
  config?: ReceiptConfig,
  outletId?: string | null,
): Promise<void> {
  if (!SunmiPrinter) return;
  await ensurePrinterReady();
  const outletInfo: OutletInfo = typeof outlet === "string" ? { name: outlet } : outlet;

  // LAN cashier printer (if configured for this outlet) takes the receipt;
  // otherwise fall through to the D3 built-in head below.
  if (outletId) {
    try {
      const handled = await routeReceipt(order, outletInfo, config, outletId);
      if (handled) return;
    } catch (e: any) {
      console.error("[printer] network receipt routing:", e?.message ?? e);
    }
  }

  const r = formatReceipt(order, outletInfo, config);
  await SunmiPrinter.printFormattedReceipt({
    header: r.header,
    body: r.body,
    footer: r.footer,
    showLogo: r.showLogo,
    qrUrl: r.qrUrl,
    qrLabel: r.qrLabel,
    promoText: r.promoText,
  });
}

export async function printKitchenDocket80mm(
  order: DocketOrder,
  _outlet?: OutletInfo | string,
  outletId?: string | null,
): Promise<void> {
  if (!SunmiPrinter) return;
  await ensurePrinterReady();

  // If this outlet has LAN station printers (Bar / Kitchen / …), route the
  // dockets there (+ a consolidated master copy on the D3). routeKitchenDockets
  // returns false when none are configured, so we fall through to the legacy
  // "everything on the built-in head" loop below — a no-op until IPs are set.
  if (outletId) {
    try {
      const handled = await routeKitchenDockets(order, outletId);
      if (handled) return;
    } catch (e: any) {
      console.error("[printer] network docket routing:", e?.message ?? e);
    }
  }

  for (const station of stationsForOrder(order)) {
    const docket = formatKitchenDocket(order, station);
    if (!docket) continue;
    await SunmiPrinter.printOrderDocket(docket);
  }
}
