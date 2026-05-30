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
): Promise<void> {
  if (!SunmiPrinter) return;
  const outletInfo: OutletInfo = typeof outlet === "string" ? { name: outlet } : outlet;
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
): Promise<void> {
  if (!SunmiPrinter) return;
  for (const station of stationsForOrder(order)) {
    const docket = formatKitchenDocket(order, station);
    if (!docket) continue;
    await SunmiPrinter.printOrderDocket(docket);
  }
}
