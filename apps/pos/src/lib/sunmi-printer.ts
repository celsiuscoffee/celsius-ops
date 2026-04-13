/**
 * SUNMI D3 MINI Printer Integration (80mm thermal printer)
 *
 * Printing architecture (priority order):
 * 1. Capacitor native plugin → SUNMI PrinterX SDK (when running as Android app)
 * 2. SUNMI JS Bridge → window.sunmiInnerPrinter (when running in SUNMI WebView)
 * 3. External printer bridge → HTTP POST to localhost:8080 (USB/network printers)
 * 4. Browser print dialog → fallback for development
 */

import SunmiPrinter, { isCapacitorNative } from "./sunmi-capacitor";
import type { Outlet } from "./pos-context";

// ─── SUNMI JS Bridge Detection (legacy WebView mode) ─────

declare global {
  interface Window {
    sunmiInnerPrinter?: SunmiJSBridge;
    PrinterManager?: SunmiJSBridge;
    AndroidBridge?: { print: (data: string) => void };
  }
}

interface SunmiJSBridge {
  sendRawData?: (base64data: string) => void;
  printText?: (text: string, callback?: unknown) => void;
  printBarCode?: (
    data: string,
    symbology: number,
    height: number,
    width: number,
    callback?: unknown
  ) => void;
  printQRCode?: (data: string, size: number, callback?: unknown) => void;
  lineWrap?: (n: number, callback?: unknown) => void;
  cutPaper?: (callback?: unknown) => void;
  setAlignment?: (alignment: number, callback?: unknown) => void;
  setFontSize?: (size: number, callback?: unknown) => void;
  setBold?: (bold: boolean, callback?: unknown) => void;
  printerInit?: (callback?: unknown) => void;
}

export function isSunmiDevice(): boolean {
  return (
    isCapacitorNative() || !!(window.sunmiInnerPrinter || window.PrinterManager)
  );
}

function getSunmiJSBridge(): SunmiJSBridge | null {
  return window.sunmiInnerPrinter ?? window.PrinterManager ?? null;
}

// ─── ESC/POS Command Builder (80mm = 48 chars) ────────────

const CHARS_PER_LINE = 48; // 80mm paper, standard font (576 dots / 12 dots per char)

function padRight(str: string, len: number): string {
  return str.substring(0, len).padEnd(len);
}

function centerText(str: string): string {
  const pad = Math.max(0, Math.floor((CHARS_PER_LINE - str.length) / 2));
  return " ".repeat(pad) + str;
}

function divider(char = "-"): string {
  return char.repeat(CHARS_PER_LINE);
}

function twoColumn(left: string, right: string): string {
  const maxLeft = CHARS_PER_LINE - right.length - 1;
  return padRight(left, maxLeft) + " " + right;
}

// ─── Outlet Info ──────────────────────────────────────────

export interface OutletInfo {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
}

function formatOutletHeader(outlet: OutletInfo): string[] {
  const lines: string[] = [];
  lines.push(centerText(outlet.name));

  // Build address line
  const addressParts: string[] = [];
  if (outlet.address) addressParts.push(outlet.address);
  if (outlet.city) addressParts.push(outlet.city);
  if (outlet.state) addressParts.push(outlet.state);
  if (addressParts.length > 0) {
    const fullAddr = addressParts.join(", ");
    // Wrap long addresses across multiple centered lines
    if (fullAddr.length > CHARS_PER_LINE) {
      const mid = fullAddr.lastIndexOf(",", CHARS_PER_LINE - 1);
      if (mid > 0) {
        lines.push(centerText(fullAddr.substring(0, mid + 1).trim()));
        lines.push(centerText(fullAddr.substring(mid + 1).trim()));
      } else {
        lines.push(centerText(fullAddr));
      }
    } else {
      lines.push(centerText(fullAddr));
    }
  }

  if (outlet.phone) {
    lines.push(centerText(`Tel: ${outlet.phone}`));
  }

  return lines;
}

// ─── Receipt Formatter (80mm) ──────────────────────────────

export function formatReceipt(
  order: {
    order_number: string;
    order_type: string;
    table_number?: string | null;
    queue_number?: string | null;
    subtotal: number;
    service_charge: number;
    discount_amount: number;
    promo_discount?: number;
    total: number;
    created_at: string;
    employee_id?: string;
    pos_order_items?: {
      product_name: string;
      variant_name?: string | null;
      quantity: number;
      unit_price: number;
      modifier_total: number;
      item_total: number;
      modifiers?: unknown;
      notes?: string | null;
    }[];
    pos_order_payments?: {
      payment_method: string;
      amount: number;
    }[];
  },
  outlet: OutletInfo
): { header: string; body: string; footer: string } {
  const items = order.pos_order_items ?? [];
  const payments = order.pos_order_payments ?? [];
  const date = new Date(order.created_at);
  const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

  // ─── Header (centered, printed with special formatting) ───
  const headerLines = formatOutletHeader(outlet);

  // ─── Body (left-aligned monospace) ────────────────────────
  const bodyLines: string[] = [];

  bodyLines.push(divider("="));
  bodyLines.push(twoColumn("Order:", order.order_number));
  bodyLines.push(
    twoColumn("Date:", date.toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" }))
  );
  bodyLines.push(
    twoColumn("Time:", date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true }))
  );
  bodyLines.push(
    twoColumn(
      "Type:",
      order.order_type === "dine_in" ? "Dine-in" : "Takeaway"
    )
  );

  if (order.queue_number) {
    bodyLines.push(divider());
    bodyLines.push(centerText("QUEUE NUMBER"));
    bodyLines.push(centerText(`** ${order.queue_number} **`));
  }
  if (order.table_number) {
    bodyLines.push(twoColumn("Table:", order.table_number));
  }

  bodyLines.push(divider("="));

  // Items
  for (const item of items) {
    const qty = `${item.quantity}x`;
    const name = item.product_name;
    const price = rm(item.item_total);
    // Format: "2x Latte                     RM24.00"
    const left = `${qty} ${name}`;
    bodyLines.push(twoColumn(left, price));

    if (item.variant_name) {
      bodyLines.push(`   ${item.variant_name}`);
    }

    const mods = item.modifiers;
    if (Array.isArray(mods) && mods.length > 0) {
      const modNames = mods
        .map((m: any) => m.option?.name ?? m.group_name ?? "")
        .filter(Boolean);
      if (modNames.length > 0) {
        bodyLines.push(`   ${modNames.join(", ")}`);
      }
    }

    if (item.notes) {
      bodyLines.push(`   ** ${item.notes} **`);
    }
  }

  bodyLines.push(divider());

  // Totals
  bodyLines.push(twoColumn("Subtotal", rm(order.subtotal)));
  if (order.service_charge > 0) {
    bodyLines.push(twoColumn("Service Charge", rm(order.service_charge)));
  }
  if (order.discount_amount > 0) {
    bodyLines.push(twoColumn("Discount", `-${rm(order.discount_amount)}`));
  }
  if ((order.promo_discount ?? 0) > 0) {
    bodyLines.push(twoColumn("Promo", `-${rm(order.promo_discount!)}`));
  }
  bodyLines.push(divider("="));
  bodyLines.push(twoColumn("TOTAL", rm(order.total)));
  bodyLines.push(divider("="));

  // Payment
  for (const p of payments) {
    const method =
      p.payment_method === "cash"
        ? "Cash"
        : p.payment_method === "card"
          ? "Card"
          : p.payment_method === "ewallet"
            ? "E-Wallet"
            : p.payment_method;
    bodyLines.push(twoColumn(method, rm(p.amount)));
  }

  // ─── Footer (centered) ──────────────────────────────────
  const footerLines: string[] = [];
  footerLines.push("");
  footerLines.push(centerText("Thank you for visiting!"));
  footerLines.push(centerText("www.celsiuscoffee.com"));
  footerLines.push("");

  return {
    header: headerLines.join("\n"),
    body: bodyLines.join("\n"),
    footer: footerLines.join("\n"),
  };
}

// ─── Kitchen Docket Formatter (80mm) ───────────────────────

export function formatKitchenDocket(
  order: {
    order_number: string;
    order_type: string;
    table_number?: string | null;
    queue_number?: string | null;
    created_at: string;
    pos_order_items?: {
      product_name: string;
      variant_name?: string | null;
      quantity: number;
      kitchen_station?: string | null;
      modifiers?: unknown;
      notes?: string | null;
    }[];
  },
  station: string
): string {
  const items = (order.pos_order_items ?? []).filter(
    (i) => !station || i.kitchen_station === station
  );
  if (items.length === 0) return "";

  const date = new Date(order.created_at);
  const lines: string[] = [];

  lines.push(centerText(`** ${(station || "KITCHEN").toUpperCase()} **`));
  lines.push(divider("="));
  lines.push(twoColumn("Order:", order.order_number));
  lines.push(
    twoColumn(
      order.order_type === "dine_in" ? "DINE-IN" : "TAKEAWAY",
      order.order_type === "dine_in"
        ? `Table ${order.table_number ?? "-"}`
        : order.queue_number ?? "-"
    )
  );
  lines.push(
    twoColumn(
      "Time:",
      date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })
    )
  );
  lines.push(divider("="));

  for (const item of items) {
    const qty = `${item.quantity}x`;
    lines.push(`${qty} ${item.product_name}`);
    if (item.variant_name) lines.push(`   ${item.variant_name}`);

    const mods = item.modifiers;
    if (Array.isArray(mods) && mods.length > 0) {
      const modNames = mods
        .map((m: any) => m.option?.name ?? "")
        .filter(Boolean);
      if (modNames.length > 0) lines.push(`   ${modNames.join(", ")}`);
    }
    if (item.notes) lines.push(`   ** ${item.notes} **`);
    lines.push(divider("-"));
  }

  lines.push(centerText("-- END --"));
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

// ─── Print Dispatch ────────────────────────────────────────

/**
 * Print formatted receipt via Capacitor native SUNMI plugin (with logo)
 */
async function printFormattedViaNative(
  header: string,
  body: string,
  footer: string
): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  try {
    const { connected } = await SunmiPrinter.isConnected();
    if (!connected) return false;
    await SunmiPrinter.printFormattedReceipt({ header, body, footer });
    return true;
  } catch (err) {
    console.error("[SUNMI/Native] Formatted print error:", err);
    return false;
  }
}

/**
 * Print plain text via Capacitor native SUNMI plugin
 */
async function printViaNative(text: string): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  try {
    const { connected } = await SunmiPrinter.isConnected();
    if (!connected) return false;
    await SunmiPrinter.printReceipt({ text });
    return true;
  } catch (err) {
    console.error("[SUNMI/Native] Print error:", err);
    return false;
  }
}

/**
 * Print via SUNMI JS Bridge (legacy WebView mode)
 */
async function printViaJSBridge(text: string): Promise<boolean> {
  const printer = getSunmiJSBridge();
  if (!printer) return false;
  try {
    printer.printerInit?.();
    printer.setFontSize?.(24);
    printer.printText?.(text);
    printer.cutPaper?.();
    return true;
  } catch (err) {
    console.error("[SUNMI/JSBridge] Print error:", err);
    return false;
  }
}

/**
 * Print receipt — tries native formatted (with logo) → plain native → JS bridge → browser
 */
export async function printReceipt58mm(
  order: any,
  outlet: OutletInfo | string
) {
  // Backward compat: accept string (outlet name) or OutletInfo object
  const outletInfo: OutletInfo =
    typeof outlet === "string" ? { name: outlet } : outlet;

  const { header, body, footer } = formatReceipt(order, outletInfo);

  // 1. Native formatted (with logo + styled text)
  if (await printFormattedViaNative(header, body, footer)) return;

  // 2. Plain native (ESC/POS text only)
  const plainText = header + "\n" + body + "\n" + footer;
  if (await printViaNative(plainText)) return;

  // 3. SUNMI JS Bridge (WebView)
  if (await printViaJSBridge(plainText)) return;

  // 4. Fallback: browser print dialog
  const printWindow = window.open("", "_blank", "width=400,height=600");
  if (!printWindow) return;
  printWindow.document.write(`
    <html><head><title>Receipt</title>
    <style>body{font-family:monospace;font-size:12px;width:80mm;margin:0;padding:4mm;white-space:pre-wrap;}
    @media print{body{margin:0;padding:2mm;}}</style></head>
    <body>${plainText}</body></html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  setTimeout(() => printWindow.close(), 2000);
}

/**
 * Print kitchen docket — tries external printer → native → JS bridge → browser
 */
export async function printKitchenDocket58mm(
  order: any,
  outlet: OutletInfo | string
) {
  const items = order.pos_order_items ?? [];
  const stationSet = new Set(items.map((i: any) => i.kitchen_station).filter(Boolean)) as Set<string>;

  // If no items have a station assigned, print all items under "Kitchen"
  if (stationSet.size === 0) {
    const text = formatKitchenDocket(order, "");
    if (text) {
      if (await printViaNative(text)) return;
      if (await printViaJSBridge(text)) return;
      const printWindow = window.open("", "_blank", "width=400,height=400");
      if (printWindow) {
        printWindow.document.write(`
          <html><head><title>Kitchen Docket</title>
          <style>body{font-family:monospace;font-size:14px;font-weight:bold;width:80mm;margin:0;padding:4mm;white-space:pre-wrap;}
          @media print{body{margin:0;padding:2mm;}}</style></head>
          <body>${text}</body></html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        setTimeout(() => printWindow.close(), 2000);
      }
    }
    return;
  }

  const stations = [...stationSet];

  for (const station of stations) {
    const text = formatKitchenDocket(order, station);
    if (!text) continue;

    // 1. External printer bridge (USB/network kitchen printers)
    if (await printToExternalPrinter(station, text)) continue;

    // 2. Capacitor native plugin
    if (await printViaNative(text)) continue;

    // 3. SUNMI JS Bridge
    if (await printViaJSBridge(text)) continue;

    // 4. Browser fallback
    const printWindow = window.open("", "_blank", "width=400,height=400");
    if (!printWindow) continue;
    printWindow.document.write(`
      <html><head><title>${station} Docket</title>
      <style>body{font-family:monospace;font-size:14px;font-weight:bold;width:80mm;margin:0;padding:4mm;white-space:pre-wrap;}
      @media print{body{margin:0;padding:2mm;}}</style></head>
      <body>${text}</body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setTimeout(() => printWindow.close(), 2000);
  }
}

// ─── External Printer Bridge (for USB/Network kitchen printers) ───

export async function printToExternalPrinter(
  station: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:8080/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printer: station.toLowerCase(), data: text }),
    });
    return res.ok;
  } catch {
    console.warn(
      `[PRINT] External printer bridge not available for station: ${station}`
    );
    return false;
  }
}

// ─── Re-exports for backward compat ──────────────────────

/** @deprecated Use printReceipt58mm instead */
export const printToSunmi = printViaJSBridge;
