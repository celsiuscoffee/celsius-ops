/**
 * Pickup-app station-routed printer.
 *
 * Mirrors the POS register's multi-printer pipeline so the staff KDS
 * (order.celsiuscoffee.com/staff/kds) prints to the SAME physical
 * printer network as the POS — same `pos_printer_config` rows, same
 * station-routing, same local print bridge at `localhost:8080`.
 *
 * Flow:
 *   1. Load printer configs for the outlet once (cached).
 *   2. When printing a kitchen slip: group items by `kitchen_station`
 *      (looked up from the products catalog), build one docket per
 *      station, POST each to localhost:8080/print with the station's
 *      IP/port baked in.
 *   3. If NO configs exist for the outlet (most outlets right now),
 *      return false so the caller falls back to its existing
 *      single-printer path (SUNMI built-in / Capacitor native).
 *
 * Without this, the pickup KDS would print a single combined slip
 * on the counter's SUNMI even when the outlet has separate Bar /
 * Counter / Kitchen printers wired in the BO.
 */

// Use the order app's existing supabase-js browser client (anon key).
// We don't pull `@supabase/ssr` here because the order app's
// dependency tree doesn't ship it — the cookie-aware SSR client lives
// in the POS app, not here.
import { createClient } from "@supabase/supabase-js";

type PrinterConfig = {
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

type ProductLite = {
  id: string;
  kitchen_station?: string | null;
};

type OrderItemLite = {
  product_id: string;
  product_name: string;
  variant_name?: string | null;
  quantity: number;
  modifiers?: unknown;
  notes?: string | null;
};

type OrderLite = {
  order_number: string;
  store_id: string;
  pickup_at?: string | null;
  created_at: string;
  notes?: string | null;
  customer_name?: string | null;
  order_items: OrderItemLite[];
};

// ── Per-outlet caches ────────────────────────────────────────
// Loaded lazily on first print attempt. 5-minute TTL: a BO admin
// change (Printers UI, product station re-assign) shows up in
// printing within a tick rather than requiring a kiosk restart.
const TTL_MS = 5 * 60 * 1000;
const configCache = new Map<string, { configs: PrinterConfig[]; loadedAt: number }>();
let productsCache: { byId: Map<string, ProductLite>; loadedAt: number } | null = null;

let supabaseSingleton: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (typeof window === "undefined") return null;
  if (supabaseSingleton) return supabaseSingleton;
  supabaseSingleton = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return supabaseSingleton;
}

async function loadConfigs(outletId: string): Promise<PrinterConfig[]> {
  const hit = configCache.get(outletId);
  if (hit && Date.now() - hit.loadedAt < TTL_MS) return hit.configs;
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("pos_printer_config")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("is_enabled", true);
  const configs = (data ?? []) as PrinterConfig[];
  configCache.set(outletId, { configs, loadedAt: Date.now() });
  return configs;
}

async function loadProductsMap(): Promise<Map<string, ProductLite>> {
  if (productsCache && Date.now() - productsCache.loadedAt < TTL_MS) {
    return productsCache.byId;
  }
  const sb = getSupabase();
  if (!sb) return new Map();
  // Catalog is ~80 rows brand-wide; small enough to fetch all in one
  // shot and avoid an N+1 on every print. anon SELECT is permitted on
  // products (it's the public menu catalog).
  const { data } = await sb
    .from("products")
    .select("id, kitchen_station");
  const byId = new Map<string, ProductLite>();
  for (const row of (data ?? []) as Array<{ id: string; kitchen_station: string | null }>) {
    byId.set(row.id, { id: row.id, kitchen_station: row.kitchen_station });
  }
  productsCache = { byId, loadedAt: Date.now() };
  return byId;
}

// ── Docket formatter ──────────────────────────────────────────
// Plain-text 80mm-width slip. Same column layout as the POS
// printKitchenDocket so prep staff see identical formatting
// regardless of channel (in-store vs pickup).
const WIDTH = 32;

function center(s: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - s.length) / 2));
  return " ".repeat(pad) + s;
}
function divider(ch: string): string {
  return ch.repeat(WIDTH);
}
function twoCol(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function formatDocket(order: OrderLite, station: string, items: OrderItemLite[]): string {
  const lines: string[] = [];
  const stationLabel = (station || "KITCHEN").toUpperCase();
  const date = new Date(order.created_at);
  const timeStr = date.toLocaleTimeString("en-MY", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  lines.push(center(`** ${stationLabel} **`));
  lines.push(divider("="));
  lines.push(twoCol("Order:", order.order_number));
  lines.push(twoCol("PICKUP", order.order_number));
  if (order.pickup_at) {
    const pa = new Date(order.pickup_at);
    lines.push(twoCol("Pickup:", pa.toLocaleTimeString("en-MY", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    })));
  }
  lines.push(twoCol("Time:", timeStr));
  if (order.customer_name) lines.push(twoCol("Name:", order.customer_name));
  lines.push(divider("="));

  for (const item of items) {
    lines.push(`${item.quantity}x ${item.product_name}`);
    if (item.variant_name) lines.push(`   ${item.variant_name}`);
    const mods = item.modifiers;
    if (Array.isArray(mods) && mods.length > 0) {
      const modNames = mods
        .map((m: { option?: { name?: string }; name?: string }) => m.option?.name ?? m.name ?? "")
        .filter(Boolean);
      if (modNames.length > 0) lines.push(`   ${modNames.join(", ")}`);
    }
    if (item.notes) lines.push(`   ** ${item.notes} **`);
    lines.push(divider("-"));
  }
  lines.push(center("-- END --"));
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

// ── Bridge POST ──────────────────────────────────────────────
// Hits the same `localhost:8080/print` endpoint the POS uses.
// Returns true when the bridge accepts the job (status 2xx); false
// on any failure — including no bridge running, network error, or
// the printer being unreachable. Callers should treat `false` as
// "fell back to the existing per-app print path."

async function postToBridge(station: string, text: string, ip: string | null, port: number | null): Promise<boolean> {
  const payload: Record<string, unknown> = {
    printer: station.toLowerCase(),
    data: text,
  };
  if (ip) {
    payload.ip = ip;
    payload.port = port ?? 9100;
  }
  try {
    const res = await fetch("http://localhost:8080/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Try printing one kitchen docket per station onto the configured
 * physical printers. Returns true if AT LEAST ONE station's docket
 * was sent to a real printer; false if no configs exist or the
 * bridge is offline, in which case the caller should fall through
 * to its existing single-printer path.
 *
 * @param order Pickup order with items.
 */
export async function printOrderToStationPrinters(
  order: OrderLite,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!order.store_id) return false;

  const [configs, productsById] = await Promise.all([
    loadConfigs(order.store_id),
    loadProductsMap(),
  ]);
  // Only docket printers matter for kitchen slips. Receipt printers
  // are handled by the existing receipt flow (single printer per
  // outlet).
  const docketConfigs = configs.filter((c) => c.printer_type === "docket");
  if (docketConfigs.length === 0) return false;

  // Group items by station — fall through to "Kitchen" for any item
  // whose product doesn't have a station assigned, so a misconfigured
  // catalog doesn't drop items silently.
  const byStation = new Map<string, OrderItemLite[]>();
  for (const item of order.order_items) {
    const product = productsById.get(item.product_id);
    const station = product?.kitchen_station?.trim() || "Kitchen";
    const bucket = byStation.get(station) ?? [];
    bucket.push(item);
    byStation.set(station, bucket);
  }

  // Print each bucket onto its configured printer. Buckets without
  // a matching printer config get printed to the bridge under their
  // station name without an IP — the bridge can decide what to do
  // (typically: fall back to the built-in printer or queue).
  let anySent = false;
  for (const [station, items] of byStation.entries()) {
    if (items.length === 0) continue;
    const text = formatDocket(order, station, items);
    const config = docketConfigs.find(
      (c) => (c.station ?? "").toLowerCase() === station.toLowerCase(),
    );
    const ok = await postToBridge(station, text, config?.ip_address ?? null, config?.port ?? null);
    if (ok) anySent = true;
  }
  return anySent;
}

/** Invalidate the cached configs for an outlet. Call after the BO
 *  Printers UI updates a row if you want the change to apply
 *  immediately rather than at the next 5-minute refresh. */
export function invalidateStationPrinterCache(outletId?: string) {
  if (outletId) configCache.delete(outletId);
  else configCache.clear();
  productsCache = null;
}
