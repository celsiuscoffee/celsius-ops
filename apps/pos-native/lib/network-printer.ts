import SunmiPrinter from "@/modules/sunmi-printer";
import { supabase } from "./supabase";
import { usePrintPrefs } from "./print-prefs";
import {
  formatKitchenDocket,
  stationsForOrder,
  formatReceipt,
  type DocketOrder,
  type DocketData,
  type ReceiptOrder,
  type OutletInfo,
  type ReceiptConfig,
} from "./receipt-format";

/**
 * LAN (network) thermal-printer routing for the SUNMI register.
 *
 * The D3 has ONE built-in 80mm head. To split tickets across the shop —
 * "Bar prints drinks, Kitchen prints hot food, the counter prints the
 * whole order" — outlets add network printers in BackOffice → POS →
 * Printers (table `pos_printer_config`). Each docket printer carries a
 * `station` ("Bar" / "Kitchen" / "Counter" / "Pastry") that matches the
 * product's kitchen_station.
 *
 * Routing (see routeKitchenDockets):
 *   - If the outlet has NO enabled network docket printers → return false
 *     so the caller keeps today's behavior (everything on the D3 built-in).
 *     This makes the whole feature a no-op until the user enters IPs.
 *   - Otherwise the D3 built-in prints ONE consolidated "ORDER" docket
 *     (the counter / POS master copy = all items), and each LAN station
 *     printer prints only its station's items. A LAN failure falls back to
 *     printing that station on the D3 so a ticket is never silently lost.
 *
 * Bytes go to the native `printNetworkRaw(host, port, number[], timeoutMs)`
 * (a one-shot TCP socket to port 9100). We build generic ESC/POS here so it
 * works with any Epson-compatible 80mm head (XPrinter, etc.).
 */

export type PrinterConfig = {
  id: string;
  outlet_id: string;
  name: string;
  printer_type: "docket" | "receipt";
  station: string | null;
  connection_type: "network" | "usb" | "bluetooth" | "built_in";
  ip_address: string | null;
  port: number | null;
  is_enabled: boolean;
};

// ─── config cache (60s) ─────────────────────────────────────
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; rows: PrinterConfig[] }>();

export async function fetchPrinterConfigs(outletId: string): Promise<PrinterConfig[]> {
  const hit = cache.get(outletId);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows;
  try {
    const { data, error } = await supabase
      .from("pos_printer_config")
      .select("id, outlet_id, name, printer_type, station, connection_type, ip_address, port, is_enabled")
      .eq("outlet_id", outletId)
      .eq("is_enabled", true);
    if (error) throw error;
    const rows = (data ?? []) as PrinterConfig[];
    cache.set(outletId, { at: Date.now(), rows });
    return rows;
  } catch (e) {
    // Read failure → reuse last good cache if we have one, else treat the
    // outlet as having no network printers (safe: caller uses built-in).
    if (hit) return hit.rows;
    console.warn("[net-printer] config fetch failed:", (e as any)?.message ?? e);
    return [];
  }
}

export function clearPrinterConfigCache(outletId?: string) {
  if (outletId) cache.delete(outletId);
  else cache.clear();
}

function isNetwork(p: PrinterConfig): boolean {
  return p.connection_type === "network" && !!p.ip_address;
}

// ─── ESC/POS byte builder ───────────────────────────────────
// Minimal Epson-compatible command set; accumulates a number[] of 0-255
// byte values that the native side writes straight to the socket.
const DIV = "-".repeat(32);

class Esc {
  private b: number[] = [];
  raw(...n: number[]) {
    for (const x of n) this.b.push(x & 0xff);
    return this;
  }
  init() {
    return this.raw(0x1b, 0x40);
  }
  align(a: "left" | "center" | "right") {
    return this.raw(0x1b, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
  }
  bold(on: boolean) {
    return this.raw(0x1b, 0x45, on ? 1 : 0);
  }
  /** GS ! n — width/height multipliers 1-8. */
  size(w: number, h: number) {
    const ww = Math.max(0, Math.min(7, w - 1));
    const hh = Math.max(0, Math.min(7, h - 1));
    return this.raw(0x1d, 0x21, (ww << 4) | hh);
  }
  text(s: string) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      // Printable ASCII straight through; newline preserved; anything else
      // (accents, emoji) becomes '?' so the head never chokes on a codepage.
      this.b.push(c === 0x0a ? 0x0a : c >= 0x20 && c <= 0x7e ? c : 0x3f);
    }
    return this;
  }
  line(s = "") {
    return this.text(s).raw(0x0a);
  }
  /** ESC d n — feed n lines, then partial cut. */
  cut() {
    return this.raw(0x1b, 0x64, 3).raw(0x1d, 0x56, 0x01);
  }
  bytes() {
    return this.b;
  }
}

/** A station kitchen docket → ESC/POS bytes (mirrors the native LineApi look). */
function buildDocketBytes(d: DocketData): number[] {
  const e = new Esc().init().align("center");

  // Station header — big + bold.
  e.bold(true).size(2, 2).line(d.station || "KITCHEN").size(1, 1).bold(false);
  e.line(DIV);

  // Order info.
  e.bold(true).size(1, 2).line(`Order #${d.orderNumber}`).size(1, 1).bold(false);
  let typeLine = d.orderType || "";
  if (d.tableNumber) typeLine += `  |  ${d.tableLabel || "Table"} ${d.tableNumber}`;
  else if (d.queueNumber) typeLine += `  |  Q: ${d.queueNumber}`;
  if (typeLine.trim()) e.bold(true).line(typeLine).bold(false);
  if (d.time) e.line(d.time);
  e.line(DIV).line("");

  // Items — same line-shape parsing the native docket renderer uses.
  e.align("left");
  for (const raw of (d.items || "").split("\n")) {
    if (raw.startsWith("---")) {
      e.bold(false).size(1, 1).line("").align("center").line(DIV).align("left").line("");
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      // Item note, e.g. "** No sugar **"
      e.bold(true).size(1, 1).line("  " + trimmed.replace(/\*/g, "").trim());
      continue;
    }
    if (raw.startsWith("   ")) {
      // Variant / modifiers — indented, normal weight.
      e.bold(false).size(1, 1).line(raw);
      continue;
    }
    if (trimmed) {
      // Main item line, e.g. "2x Roti Bakar" — tall + bold.
      e.bold(true).size(1, 2).line(raw).size(1, 1).bold(false);
    }
  }

  e.bold(false).size(1, 1).line("").align("center").line(DIV).line("- END -");
  e.cut();
  return e.bytes();
}

/** A receipt (header/body/footer text) → ESC/POS bytes for a LAN cashier printer. */
function buildReceiptBytes(header: string, body: string, footer: string): number[] {
  const e = new Esc().init().align("center");
  const headLines = header.split("\n");
  headLines.forEach((l, i) => {
    if (!l.trim()) return;
    e.bold(i === 0).size(i === 0 ? 1 : 1, 1).line(l.trim());
  });
  e.bold(false).align("left");
  for (const l of body.split("\n")) e.line(l);
  e.align("center").line("");
  for (const l of footer.split("\n")) if (l.trim()) e.line(l.trim());
  e.cut();
  return e.bytes();
}

async function sendToNetwork(p: PrinterConfig, bytes: number[]): Promise<void> {
  if (!SunmiPrinter) return; // dev / Expo Go no-op
  await SunmiPrinter.printNetworkRaw(p.ip_address as string, p.port ?? 9100, bytes, 4000);
}

/**
 * Route an order's kitchen docket(s) to the configured LAN station printers.
 *
 * @returns true  → handled here (caller must NOT run its built-in loop)
 *          false → no network docket printers; caller prints on the D3
 */
export async function routeKitchenDockets(order: DocketOrder, outletId: string): Promise<boolean> {
  const rows = await fetchPrinterConfigs(outletId);
  const netDockets = rows.filter((r) => r.printer_type === "docket" && isNetwork(r));
  if (netDockets.length === 0) return false; // no LAN station printers → built-in fallback

  // 1. Counter / POS master copy: the WHOLE order on the D3 built-in.
  //    Skippable per-terminal (Settings → "Counter master docket"): the customer
  //    receipt already lists every item, so some counters don't want the
  //    duplicate ticket. Station printers (below) are unaffected either way.
  if (usePrintPrefs.getState().printMaster) {
    try {
      const all = formatKitchenDocket(order, ""); // "" → all items, no station filter
      if (all && SunmiPrinter) {
        all.station = "ORDER";
        await SunmiPrinter.printOrderDocket(all);
      }
    } catch (e) {
      console.error("[net-printer] master docket:", (e as any)?.message ?? e);
    }
  }

  // 2. Each LAN station printer gets only its station's items.
  for (const printer of netDockets) {
    const d = formatKitchenDocket(order, printer.station ?? "");
    if (!d) continue; // nothing for this station in this order
    try {
      await sendToNetwork(printer, buildDocketBytes(d));
    } catch (e) {
      console.error(`[net-printer] ${printer.name} (${printer.ip_address}):`, (e as any)?.message ?? e);
      // Don't lose the ticket — fall back to the D3 for this station.
      try {
        if (SunmiPrinter) await SunmiPrinter.printOrderDocket(d);
      } catch {
        /* built-in already faulted upstream; nothing more to do */
      }
    }
  }

  // 3. Stations that have items but NO network printer of their own still need a
  //    make-ticket — print each on the D3. So e.g. Kitchen gets its own clean
  //    docket even before its LAN printer is wired, and removing/sharing a printer
  //    never silently drops a station's docket. (The master copy above, if enabled,
  //    is a consolidated expo copy on top; this is the per-station make copy.)
  const netStations = new Set(
    netDockets.map((p) => (p.station ?? "").trim().toLowerCase()).filter(Boolean),
  );
  for (const station of stationsForOrder(order)) {
    if (!station || netStations.has(station.trim().toLowerCase())) continue;
    const d = formatKitchenDocket(order, station);
    if (d && SunmiPrinter) {
      try {
        await SunmiPrinter.printOrderDocket(d);
      } catch (e) {
        console.error(`[net-printer] D3 station docket ${station}:`, (e as any)?.message ?? e);
      }
    }
  }
  return true;
}

/**
 * Route a receipt to a configured LAN receipt printer.
 *
 * @returns true  → sent to a network receipt printer
 *          false → none configured (or send failed); caller prints on the D3
 */
export async function routeReceipt(
  order: ReceiptOrder,
  outlet: OutletInfo,
  config: ReceiptConfig | undefined,
  outletId: string,
): Promise<boolean> {
  const rows = await fetchPrinterConfigs(outletId);
  const netReceipt = rows.find((r) => r.printer_type === "receipt" && isNetwork(r));
  if (!netReceipt) return false;
  const r = formatReceipt(order, outlet, config);
  try {
    await sendToNetwork(netReceipt, buildReceiptBytes(r.header, r.body, r.footer));
    return true;
  } catch (e) {
    console.error("[net-printer] receipt:", (e as any)?.message ?? e);
    return false; // fall back to built-in
  }
}
