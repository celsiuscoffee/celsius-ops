"use client";

/**
 * Staff Order Management — optimised for Sunmi V3 (Android touch POS).
 *
 * Layout: single scrollable queue, largest actions at bottom thumb zone.
 * Auto-prints 80mm kitchen slip when a new order arrives.
 * Staff taps "Ready" → customer gets push notification.
 * Staff taps "Collected" → order is archived.
 * Staff can cancel any pending/preparing order.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Wifi, Printer, Receipt, X, CheckCircle, Package, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { printKitchenSlip, printReceipt } from "@/lib/thermal-print";
import { hasSunmiPrinter } from "@/lib/sunmi-printer";
import { isCapacitorNative, nativePrintKitchenSlip, nativePrintReceipt } from "@/lib/sunmi-native";
import { getSession } from "@/lib/staff-auth";
import { StaffNav } from "@/components/staff-nav";
import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  preparing: { label: "Preparing",   cls: "bg-amber-100 text-amber-700" },
  ready:     { label: "Ready",       cls: "bg-green-100 text-green-700" },
};

function playChime() {
  try {
    const ctx  = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Three-tone ascending chime, repeated 3 times
    for (let rep = 0; rep < 3; rep++) {
      const notes = [660, 880, 1047]; // E5, A5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.frequency.value = freq;
        const start = ctx.currentTime + rep * 1.2 + i * 0.3;
        gain.gain.setValueAtTime(0.4, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + 0.8);
        osc.start(start);
        osc.stop(start + 0.8);
      });
    }
  } catch { /* ignore */ }
}

function timeAgo(dateStr: string) {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

// Prep-time SLA bucket. Drives card border color so a busy barista can triage
// at a glance: green = on track, amber = slipping, red = overdue.
//   preparing: green ≤3m, amber 3-7m, red >7m
//   ready:     green ≤20m (still warm), red after that — same as the prior
//              "stale" highlight, just expressed via the same bucket helper
function prepBucket(createdAt: string, status: string): "green" | "amber" | "red" | "none" {
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  const mins = elapsedMs / 60_000;
  if (status === "preparing") {
    if (mins <= 3) return "green";
    if (mins <= 7) return "amber";
    return "red";
  }
  if (status === "ready") {
    return mins <= 20 ? "green" : "red";
  }
  return "none";
}

function firstName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim().split(/\s+/)[0];
  return trimmed || null;
}

// ── Print helper — renders receipt inline + calls window.print() ──
// No popups, no redirects, no external apps. Works everywhere.

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  "conezion": "Conezion",
  "tamarind": "Tamarind Square",
  "putrajaya": "Celsius Coffee Putrajaya",
};

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildKitchenHtml(order: OrderWithItems): string {
  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  const items = order.order_items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s: { label: string }) => esc(s.label)).join(", ");
    const note = item.modifiers?.specialInstructions;
    return `<div style="margin-bottom:7px">
      <div style="font-size:13px;font-weight:bold">${item.quantity}&times; ${esc(item.product_name)}</div>
      ${mods ? `<div style="font-size:11px;padding-left:10px;color:#333">${mods}</div>` : ""}
      ${note ? `<div style="font-size:11px;padding-left:10px;font-style:italic">* ${esc(note)}</div>` : ""}
    </div>`;
  }).join("");

  return `
    <div style="background:#000;color:#fff;text-align:center;font-size:11px;font-weight:bold;padding:2px 0;letter-spacing:2px;margin-bottom:6px">KITCHEN ORDER</div>
    <div style="text-align:center"><div style="font-size:15px;font-weight:bold;letter-spacing:1px">Celsius Coffee</div><div style="font-size:11px">${esc(store)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:56px;font-weight:900;text-align:center;line-height:1;margin:6px 0;letter-spacing:-2px">#${esc(order.order_number)}</div>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase">${esc(time)}</div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    ${items}
    ${order.notes ? `<div style="border:2px solid #000;border-radius:2px;padding:4px 6px;margin:4px 0"><div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Note</div><div style="font-size:12px;margin-top:2px">${esc(order.notes)}</div></div>` : ""}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:10px;text-align:center;margin-top:6px">SELF-PICKUP</div>
  `;
}

function buildReceiptHtml(order: OrderWithItems): string {
  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(order.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
  const fmt = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

  const items = order.order_items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s: { label: string }) => esc(s.label)).join(", ");
    return `<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="font-weight:bold">${item.quantity}&times; ${esc(item.product_name)}</span><span>${fmt(item.unit_price * item.quantity)}</span></div>
      ${mods ? `<div style="font-size:11px;padding-left:10px;color:#333">${mods}</div>` : ""}
    </div>`;
  }).join("");

  return `
    <div style="text-align:center"><div style="font-size:15px;font-weight:bold;letter-spacing:1px">Celsius Coffee</div><div style="font-size:11px">${esc(store)}</div><div style="font-size:10px;margin-top:2px">${esc(date)} &bull; ${esc(time)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="text-align:center"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase">Order</div><div style="font-size:32px;font-weight:900;line-height:1.1">#${esc(order.order_number)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    ${items}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
    ${order.discount_amount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>Voucher</span><span>-${fmt(order.discount_amount)}</span></div>` : ""}
    ${order.sst_amount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>SST (6%)</span><span>${fmt(order.sst_amount)}</span></div>` : ""}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold;margin-top:4px"><span>TOTAL</span><span>${fmt(order.total)}</span></div>
    <div style="margin-top:4px;font-size:10px">Payment: ${esc((order.payment_method ?? "").toUpperCase().replace(/_/g, " "))}</div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:10px;text-align:center;margin-top:6px">Thank you!</div>
  `;
}

function doPrint(_orderId: string, type: "kitchen" | "receipt", order: OrderWithItems) {
  // Priority 1: Capacitor native app (Sunmi AIDL) — silent, instant
  if (isCapacitorNative()) {
    if (type === "kitchen") {
      nativePrintKitchenSlip(order).catch(console.error);
    } else {
      nativePrintReceipt(order).catch(console.error);
    }
    return;
  }

  // Priority 2: Sunmi JS bridge (Sunmi browser)
  if (hasSunmiPrinter()) {
    if (type === "kitchen") printKitchenSlip(order);
    else printReceipt(order);
    return;
  }

  // Priority 3: Fallback — render in-page and use window.print()
  const html = type === "kitchen" ? buildKitchenHtml(order) : buildReceiptHtml(order);

  let zone = document.getElementById("kds-print-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = "kds-print-zone";
    document.body.appendChild(zone);
  }
  zone.innerHTML = html;

  // Add print-only stylesheet if not already present
  if (!document.getElementById("kds-print-styles")) {
    const style = document.createElement("style");
    style.id = "kds-print-styles";
    style.textContent = `
      #kds-print-zone {
        display: none;
      }
      @media print {
        body > *:not(#kds-print-zone) {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        #kds-print-zone {
          display: block !important;
          position: fixed;
          top: 0;
          left: 0;
          width: 80mm;
          padding: 2mm 4mm;
          background: #fff;
          color: #000;
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          z-index: 999999;
        }
        @page {
          size: 80mm auto;
          margin: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Small delay for DOM to update, then print
  setTimeout(() => window.print(), 100);
}

// ── Order card ─────────────────────────────────────────────────────────────

function StaffOrderCard({
  order,
  onAdvance,
  onCancel,
}: {
  order: OrderWithItems;
  onAdvance: (id: string, status: "ready" | "completed" | "preparing") => Promise<void>;
  onCancel:  (id: string) => Promise<void>;
}) {
  const [busy,  setBusy]  = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const badge = STATUS_BADGE[order.status];
  const bucket = prepBucket(order.created_at, order.status);
  const borderCls =
    bucket === "red"   ? "border-red-300"   :
    bucket === "amber" ? "border-amber-300" :
    bucket === "green" ? "border-green-300" :
    "border-transparent";
  const customerFirst = firstName(order.customer_name);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErrMsg("");
    try { await fn(); } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Something went wrong");
      setTimeout(() => setErrMsg(""), 4000);
    } finally { setBusy(false); }
  }

  return (
    <div className={`bg-white rounded-2xl border-2 overflow-hidden transition-all ${borderCls}`}>
      {/* Card header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-3xl font-black text-[#160800] leading-none">#{order.order_number}</span>
          {badge && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
              {badge.label}
            </span>
          )}
          {customerFirst && (
            <span className="text-sm font-semibold text-[#160800]/80 truncate">
              {customerFirst}
            </span>
          )}
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className="text-xs text-muted-foreground">{timeAgo(order.created_at)} ago</p>
          <p className="text-xs font-bold text-[#160800]">
            RM {(order.total / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Items */}
      <div className="px-4 pb-3 space-y-1.5 border-b border-border/40">
        {order.order_items.map((item) => {
          const mods = (item.modifiers.selections ?? []).map((s: { label: string }) => s.label).join(" · ");
          return (
            <div key={item.id}>
              <p className="text-sm font-bold text-[#160800]">
                {item.quantity}× {item.product_name}
              </p>
              {mods && <p className="text-xs text-muted-foreground ml-3">{mods}</p>}
              {item.modifiers.specialInstructions && (
                <p className="text-xs text-amber-700 ml-3 italic font-medium">
                  ★ {item.modifiers.specialInstructions}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {errMsg && (
        <p className="px-4 pb-1 text-xs text-red-500 font-medium">{errMsg}</p>
      )}

      {/* Actions */}
      <div className="px-3 py-3 flex gap-2">
        {order.status === "preparing" && (
          <>
            <button
              onClick={() => act(() => onAdvance(order.id, "ready"))}
              disabled={busy}
              className="flex-1 bg-green-600 text-white rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2 active:opacity-80"
            >
              <CheckCircle className="h-4 w-4" />
              Ready
            </button>
            <button
              onClick={() => doPrint(order.id, "kitchen", order)}
              className="w-12 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              onClick={() => act(() => onCancel(order.id))}
              disabled={busy}
              className="w-12 flex items-center justify-center rounded-xl border border-red-200 text-red-500 active:bg-red-50"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}

        {order.status === "ready" && (
          <>
            <button
              onClick={() => act(() => onAdvance(order.id, "preparing"))}
              disabled={busy}
              title="Undo Ready (move back to Preparing)"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => act(() => onAdvance(order.id, "completed"))}
              disabled={busy}
              className="flex-1 bg-[#160800] text-white rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2 active:opacity-80"
            >
              <Package className="h-4 w-4" />
              Collected
            </button>
            <button
              onClick={() => doPrint(order.id, "kitchen", order)}
              title="Reprint kitchen slip"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              onClick={() => doPrint(order.id, "receipt", order)}
              title="Print receipt"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Receipt className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Completed card (read-only) ─────────────────────────────────────────────

function CompletedOrderCard({ order }: { order: OrderWithItems }) {
  const totalRM = (order.total / 100).toFixed(2);
  return (
    <div className="bg-white rounded-2xl border border-border/40 overflow-hidden opacity-80">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="text-xl font-black text-[#160800]">#{order.order_number}</span>
          <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(order.created_at)} ago</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Done</span>
          <p className="text-xs font-bold text-[#160800]">RM {totalRM}</p>
          <button
            onClick={() => doPrint(order.id, "kitchen", order)}
            title="Reprint kitchen slip"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => doPrint(order.id, "receipt", order)}
            title="Reprint receipt"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted"
          >
            <Receipt className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 space-y-0.5 border-t border-border/30 pt-2">
        {order.order_items.map((item) => (
          <p key={item.id} className="text-xs text-muted-foreground">
            {item.quantity}× {item.product_name}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StaffOrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [mounted, setMounted] = useState(false);

  // Auth guard + session init (client-only)
  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/staff/login"); return; }
    setSession(s);
    setMounted(true);
  }, [router]);

  const storeId = session?.storeId ?? "";
  const [autoPrint, setAutoPrint] = useState(true);
  const [tab,       setTab]       = useState<"active" | "completed">("active");
  const [orders,    setOrders]    = useState<OrderWithItems[]>([]);
  const [completed, setCompleted] = useState<OrderWithItems[]>([]);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [tick,      setTick]      = useState(0); // for time-ago refresh
  const [outletBusy, setOutletBusy] = useState(false);
  const [busyToggling, setBusyToggling] = useState(false);

  const autoPrintRef = useRef(autoPrint);
  useEffect(() => { autoPrintRef.current = autoPrint; }, [autoPrint]);

  // Read autoPrint preference from localStorage after mount
  useEffect(() => {
    setAutoPrint(localStorage.getItem("kds-autoprint") !== "off");
  }, []);

  // Sync busy state from server on mount + every 60s (so other devices stay in sync)
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const fetchBusy = async () => {
      try {
        const res = await fetch(`/api/staff/outlet/busy?storeId=${encodeURIComponent(storeId)}`);
        const data = await res.json() as { busy?: boolean };
        if (!cancelled && typeof data.busy === "boolean") setOutletBusy(data.busy);
      } catch { /* keep last known state */ }
    };
    fetchBusy();
    const t = setInterval(fetchBusy, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [storeId]);

  async function toggleBusy() {
    if (!storeId || busyToggling) return;
    setBusyToggling(true);
    const next = !outletBusy;
    setOutletBusy(next); // optimistic
    try {
      const res = await fetch("/api/staff/outlet/busy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, busy: next }),
      });
      if (!res.ok) setOutletBusy(!next); // rollback
    } catch {
      setOutletBusy(!next);
    } finally {
      setBusyToggling(false);
    }
  }

  // Refresh time-ago labels every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  void tick; // suppress unused warning

  function toggleAutoPrint() {
    setAutoPrint((v) => {
      const next = !v;
      localStorage.setItem("kds-autoprint", next ? "on" : "off");
      return next;
    });
  }

  const fetchOrders = useCallback(async (sid: string) => {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("store_id", sid)
      .in("status", ["preparing", "ready"])
      .order("created_at", { ascending: true });
    if (data) setOrders(data as OrderWithItems[]);
  }, []);

  // Track known order IDs for detecting new arrivals during polling
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!storeId) return;
    fetchOrders(storeId);
  }, [storeId, fetchOrders]);

  // Realtime subscription + polling fallback
  useEffect(() => {
    if (!storeId) return;
    const supabase = getSupabaseClient();
    let realtimeConnected = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // ── Polling fallback: fetches orders every 5s if realtime is down ──
    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        const { data } = await supabase
          .from("orders")
          .select("*, order_items(*)")
          .eq("store_id", storeId)
          .in("status", ["preparing", "ready"])
          .order("created_at", { ascending: true });
        if (!data) return;
        const fresh = data as OrderWithItems[];
        // Detect new orders that weren't in previous poll
        const freshIds = new Set(fresh.map((o) => o.id));
        for (const order of fresh) {
          if (!knownOrderIdsRef.current.has(order.id)) {
            // New order detected via polling
            playChime();
            if (autoPrintRef.current) setTimeout(() => doPrint(order.id, "kitchen", order), 400);
          }
        }
        knownOrderIdsRef.current = freshIds;
        setOrders(fresh);
      }, 5000);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    const channel = supabase
      .channel(`staff-orders-${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const { data } = await supabase
              .from("orders").select("*, order_items(*)").eq("id", (payload.new as { id: string }).id).single();
            const order = data as OrderWithItems | null;
            if (order && ["preparing", "ready"].includes(order.status)) {
              knownOrderIdsRef.current.add(order.id);
              setOrders((prev) => [...prev, order]);
              playChime();
              if (autoPrintRef.current) setTimeout(() => doPrint(order.id, "kitchen", order), 400);
            }
          }

          if (payload.eventType === "UPDATE") {
            const updated = payload.new as OrderRow;
            if (updated.status === "completed" || updated.status === "failed") {
              knownOrderIdsRef.current.delete(updated.id);
              setOrders((prev) => prev.filter((o) => o.id !== updated.id));
            } else if (updated.status === "preparing") {
              // Payment confirmed → new order entering queue
              const { data } = await supabase
                .from("orders").select("*, order_items(*)").eq("id", updated.id).single();
              const order = data as OrderWithItems | null;
              if (order) {
                setOrders((prev) => {
                  const exists = prev.some((o) => o.id === order.id);
                  if (exists) return prev.map((o) => o.id === order.id ? { ...o, ...order } : o);
                  knownOrderIdsRef.current.add(order.id);
                  playChime();
                  if (autoPrintRef.current) setTimeout(() => doPrint(order.id, "kitchen", order), 400);
                  return [...prev, order];
                });
              }
            } else {
              setOrders((prev) => prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o));
            }
          }
        }
      )
      .subscribe((status) => {
        realtimeConnected = status === "SUBSCRIBED";
        setConnected(realtimeConnected);
        if (realtimeConnected) {
          stopPolling();
        } else {
          // Realtime failed — start polling fallback
          startPolling();
        }
      });

    // Also seed known IDs from initial fetch
    supabase
      .from("orders")
      .select("id")
      .eq("store_id", storeId)
      .in("status", ["preparing", "ready"])
      .then(({ data }) => {
        if (data) data.forEach((o: { id: string }) => knownOrderIdsRef.current.add(o.id));
      });

    return () => {
      stopPolling();
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  async function handleAdvance(orderId: string, newStatus: "ready" | "completed" | "preparing") {
    const res  = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
    // Fallback: update local state immediately in case Realtime is slow/disconnected
    if (newStatus === "completed") {
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } else {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
    }
  }

  async function handleCancel(orderId: string) {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    });
    if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Failed"); }
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  // Fetch today's completed orders when switching to completed tab
  useEffect(() => {
    if (tab !== "completed") return;
    setLoadingCompleted(true);
    const supabase = getSupabaseClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("store_id", storeId)
      .eq("status", "completed")
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCompleted((data ?? []) as OrderWithItems[]);
        setLoadingCompleted(false);
      });
  }, [tab, storeId]);

  // Keep completed list updated via Realtime (append newly completed orders)
  useEffect(() => {
    if (tab !== "completed") return;
    const supabase = getSupabaseClient();
    const ch = supabase
      .channel(`kds-completed-${storeId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
        async (payload) => {
          const updated = payload.new as OrderRow;
          if (updated.status !== "completed") return;
          const { data } = await supabase
            .from("orders").select("*, order_items(*)").eq("id", updated.id).single();
          const order = data as OrderWithItems | null;
          if (order) setCompleted((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tab, storeId]);

  const preparing = orders.filter((o) => o.status === "preparing");
  const ready     = orders.filter((o) => o.status === "ready");
  const total     = orders.length;

  if (!mounted || !session) return <div className="min-h-dvh bg-[#160800]" />;

  return (
    <div className="min-h-dvh bg-[#f0f0f0] flex flex-col select-none pb-16">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex flex-col gap-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/celsius-wordmark-white.png"
            alt="Celsius Coffee"
            className="h-5 w-auto"
          />
          <p className="text-white/50 text-xs">{session.storeName}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleBusy}
            disabled={busyToggling}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
              outletBusy
                ? "bg-red-500/25 text-red-200 border-red-400/40"
                : "bg-white/8 text-white/40 border-white/10"
            }`}
          >
            {outletBusy ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {outletBusy ? "Busy" : "Open"}
          </button>
          {tab === "active" && (
            <button
              onClick={toggleAutoPrint}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                autoPrint
                  ? "bg-green-500/20 text-green-300 border-green-500/30"
                  : "bg-white/8 text-white/30 border-white/10"
              }`}
            >
              <Printer className="h-3 w-3" />
              {autoPrint ? "Auto-print" : "Manual"}
            </button>
          )}
          {connected
            ? <Wifi className="h-4 w-4 text-green-400" />
            : <Wifi className="h-4 w-4 text-amber-400" />
          }
        </div>
      </header>

      {outletBusy && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs font-semibold px-4 py-2 text-center shrink-0">
          Outlet marked busy — customers can&apos;t place new pickup orders.
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b shrink-0">
        <div className="flex">
          <button
            onClick={() => setTab("active")}
            className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === "active" ? "border-[#160800] text-[#160800]" : "border-transparent text-muted-foreground"
            }`}
          >
            Active
            {total > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold">
                {total}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === "completed" ? "border-[#160800] text-[#160800]" : "border-transparent text-muted-foreground"
            }`}
          >
            Completed
            {completed.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-400 text-white text-[9px] font-bold">
                {completed.length}
              </span>
            )}
          </button>
        </div>

      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-4">
        {tab === "active" ? (
          orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Package className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No active orders</p>
              <p className="text-xs text-muted-foreground/60 mt-1">New orders will appear here</p>
            </div>
          ) : (
            [...ready, ...preparing].map((order) => (
              <StaffOrderCard
                key={order.id}
                order={order}
                onAdvance={handleAdvance}
                onCancel={handleCancel}
              />
            ))
          )
        ) : loadingCompleted ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
          </div>
        ) : completed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <CheckCircle className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">No completed orders today</p>
          </div>
        ) : (
          completed.map((order) => (
            <CompletedOrderCard key={order.id} order={order} />
          ))
        )}
      </div>

      <StaffNav active="orders" />
    </div>
  );
}
