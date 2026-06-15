import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Live table → orders MAPPING for the POS-native Tables panel.
 *
 * This is intentionally NOT an occupancy state machine. Register dine-in
 * orders (pos_orders) are marked completed the instant they're rung up, so a
 * free/occupied/ready "flow" is meaningless for them — and the old panel only
 * read the QR `orders` table, so every register dine-in order was invisible and
 * tables looked permanently free. The cashier just wants to see WHICH ORDERS
 * CAME FROM WHICH TABLE, so this hook is a pure mapping over BOTH sources:
 *   - orders     → QR-table self-order (keyed by store_id)
 *   - pos_orders → register dine-in    (keyed by outlet_id)
 * grouped by a normalised table number (bare "5" or "T5" both map to "5").
 */

const WINDOW_MS = 6 * 60 * 60 * 1000; // map the last 6h of table activity
const SAFETY_REFRESH_MS = 60 * 1000;  // backstop refetch if a Realtime event is dropped
// Drop dead orders so a cancelled/failed attempt doesn't linger on a table.
const DEAD = new Set(["cancelled", "failed", "refunded", "voided"]);
// Finished orders fall off the ACTIVE view too — once served/collected the
// cashier is done with them (they remain in the History tab). This keeps the
// Tables/Orders panel (and its counts + badge) to orders still in progress.
const DONE = new Set(["completed", "served", "collected", "fulfilled"]);

export type TableOrderRef = {
  id: string;
  orderNumber: string;
  source: "qr" | "pos"; // QR-table self-order vs register dine-in
  total: number;        // sen
  status: string;
  createdAt: string;
  tableKey: string;     // normalised, e.g. "5"
};

export type TableSlot = {
  label: string;            // "T5" / user label
  zone: string;             // named floor/zone this table belongs to
  seats: number | null;     // pax / seat count, if configured
  x: number;                // normalised 0..1 position (centre)
  y: number;
  shape: "square" | "round";
  orientation: "h" | "v";   // attached-table layout direction
  orders: TableOrderRef[];  // most recent first
};

/** "T5" / "t5" / " 5 " → "5"; "" / null → null (un-mappable, skipped). */
function tableKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = String(raw).trim().replace(/^[Tt]/, "").trim();
  return k.length ? k : null;
}

type Row = {
  id: string;
  order_number: string;
  status: string;
  table_number: string | null;
  total: number | null;
  created_at: string;
};

function toRefs(rows: Row[] | null, source: "qr" | "pos"): TableOrderRef[] {
  const out: TableOrderRef[] = [];
  for (const r of rows ?? []) {
    if (DEAD.has(r.status) || DONE.has(r.status)) continue;
    // Pay-first, same rule as the pickup/Grab live queue: a QR table self-order
    // stays hidden until payment is CONFIRMED. While it's still "pending"
    // (unpaid) it must not surface on the Tables panel / QR self-orders queue —
    // otherwise staff could make or manually complete an order that was never
    // paid. It reappears the instant payment flips it to paid/preparing.
    // (Register dine-in `pos` orders are rung up already paid, so this only
    // applies to the qr source.)
    if (source === "qr" && r.status === "pending") continue;
    const k = tableKey(r.table_number);
    if (!k) continue;
    out.push({
      id: r.id,
      orderNumber: r.order_number,
      source,
      total: r.total ?? 0,
      status: r.status,
      createdAt: r.created_at,
      tableKey: k,
    });
  }
  return out;
}

/** Pass the cashier's POS outletId ("outlet-sa") + how many tables the outlet
 *  has (settings.table_count). Returns T1..Tn (plus any extra table that has
 *  orders), each with the live list of orders mapped to it. */
export function useTablesPanel(outletId: string | null | undefined, zones: { name: string; tables: { label: string; seats: number | null; x: number; y: number; shape: "square" | "round"; orientation: "h" | "v" }[] }[]) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [qr, setQr] = useState<TableOrderRef[]>([]);
  const outletRef = useRef(outletId);
  useEffect(() => { outletRef.current = outletId; }, [outletId]);

  // 1. Resolve POS outlet → pickup store_id (for the QR `orders` table).
  useEffect(() => {
    let cancelled = false;
    setStoreId(null);
    if (!outletId) return;
    (async () => {
      const { data } = await supabase
        .from("outlet_settings").select("store_id")
        .eq("loyalty_outlet_id", outletId).maybeSingle();
      if (!cancelled) setStoreId((data as { store_id?: string } | null)?.store_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [outletId]);

  // 2. Fetch QR self-orders only (last 6h, dine-in). Counter dine-in orders use
  //    a "Table Stand #" (a placard), not a floor-plan table, so they are NOT
  //    mapped here — the floor plan reflects QR-table self-orders only.
  const reload = useCallback(async () => {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    if (storeId) {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, status, order_type, table_number, total, created_at")
        .eq("store_id", storeId).eq("order_type", "dine_in")
        .gte("created_at", since).order("created_at", { ascending: false });
      setQr(toRefs(data as Row[] | null, "qr"));
    } else setQr([]);
  }, [storeId]);

  // 3. Initial load + keep live (any change to either feed → debounced refetch).
  //    A periodic safety-net refetch backs up Realtime: if a websocket event is
  //    dropped (flaky venue Wi-Fi), an order that was completed elsewhere — the
  //    guest's app, another till, a server-side auto-close — would otherwise
  //    linger here forever and keep the serving-time alarm sounding even though
  //    there are no live orders. The poll heals that within one interval.
  useEffect(() => {
    if (!outletId) return;
    void reload();
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => void reload(), 350); };
    const ch = supabase.channel(`tables-map-${outletId}`);
    if (storeId) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, bump);
    }
    ch.subscribe();
    const poll = setInterval(() => void reload(), SAFETY_REFRESH_MS);
    return () => { if (t) clearTimeout(t); clearInterval(poll); void supabase.removeChannel(ch); };
  }, [outletId, storeId, reload]);

  // 4. Compose flat slots from the configured zones (each slot tagged with its
  //    zone), orders matched by normalised table key. Any order whose table
  //    isn't in a zone is surfaced under "Other" so it's never lost.
  const slots = useMemo<TableSlot[]>(() => {
    const byKey = new Map<string, TableOrderRef[]>();
    for (const o of qr) {
      const arr = byKey.get(o.tableKey) ?? [];
      arr.push(o);
      byKey.set(o.tableKey, arr);
    }
    for (const arr of byKey.values()) arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const covered = new Set<string>();
    const slots: TableSlot[] = [];
    for (const z of zones) {
      for (const t of z.tables) {
        const k = tableKey(t.label) ?? "";
        covered.add(k);
        slots.push({ label: t.label, zone: z.name, seats: t.seats, x: t.x, y: t.y, shape: t.shape, orientation: t.orientation, orders: byKey.get(k) ?? [] });
      }
    }
    // Orders whose table isn't in any floor → an auto-gridded "Other" floor.
    const others = [...byKey].filter(([k]) => k && !covered.has(k));
    const oc = Math.max(1, Math.ceil(Math.sqrt(others.length)));
    others.forEach(([k, orders], i) => {
      slots.push({
        label: k, zone: "Other", seats: null,
        x: oc <= 1 ? 0.5 : 0.1 + ((i % oc) * 0.8) / (oc - 1),
        y: 0.15 + Math.floor(i / oc) * 0.2,
        shape: "square", orientation: "h", orders,
      });
    });
    return slots;
  }, [qr, zones]);

  // Expose `reload` so a write (e.g. marking a QR order Done) can force an
  // immediate refetch instead of waiting on the Realtime round-trip — the
  // serving-time alarm is derived from these slots, so an order that's been
  // actioned must drop off locally at once even if Realtime is lagging/dropped.
  return { slots, reload };
}
