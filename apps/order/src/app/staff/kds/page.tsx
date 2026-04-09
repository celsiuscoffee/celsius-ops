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
import { Wifi, WifiOff, Printer, X, CheckCircle, Package, Loader2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { printKitchenSlip, printReceipt } from "@/lib/thermal-print";
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
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1);
  } catch { /* ignore */ }
}

function timeAgo(dateStr: string) {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

// ── Order card ─────────────────────────────────────────────────────────────

function StaffOrderCard({
  order,
  onAdvance,
  onCancel,
}: {
  order: OrderWithItems;
  onAdvance: (id: string, status: "ready" | "completed") => Promise<void>;
  onCancel:  (id: string) => Promise<void>;
}) {
  const [busy,  setBusy]  = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const badge = STATUS_BADGE[order.status];
  const isStale = order.status === "ready" &&
    Date.now() - new Date(order.created_at).getTime() > 20 * 60 * 1000;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErrMsg("");
    try { await fn(); } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Something went wrong");
      setTimeout(() => setErrMsg(""), 4000);
    } finally { setBusy(false); }
  }

  return (
    <div className={`bg-white rounded-2xl border-2 overflow-hidden transition-all ${
      isStale ? "border-red-300" : order.status === "ready" ? "border-green-300" : "border-transparent"
    }`}>
      {/* Card header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black text-[#160800] leading-none">#{order.order_number}</span>
          {badge && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
              {badge.label}
            </span>
          )}
        </div>
        <div className="text-right">
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
              onClick={() => printKitchenSlip(order)}
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
              onClick={() => act(() => onAdvance(order.id, "completed"))}
              disabled={busy}
              className="flex-1 bg-[#160800] text-white rounded-xl py-3 font-bold text-sm flex items-center justify-center gap-2 active:opacity-80"
            >
              <Package className="h-4 w-4" />
              Collected
            </button>
            <button
              onClick={() => printReceipt(order)}
              className="w-12 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Printer className="h-4 w-4" />
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
        <div className="text-right">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Done</span>
          <p className="text-xs font-bold text-[#160800] mt-1">RM {totalRM}</p>
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

  const autoPrintRef = useRef(autoPrint);
  useEffect(() => { autoPrintRef.current = autoPrint; }, [autoPrint]);

  // Read autoPrint preference from localStorage after mount
  useEffect(() => {
    setAutoPrint(localStorage.getItem("kds-autoprint") !== "off");
  }, []);

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

  useEffect(() => { fetchOrders(storeId); }, [storeId, fetchOrders]);

  // Realtime subscription
  useEffect(() => {
    const supabase = getSupabaseClient();

    const channel = supabase
      .channel(`staff-orders-${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const { data } = await supabase
              .from("orders").select("*, order_items(*)").eq("id", (payload.new as { id: string }).id).single();
            const order = data as OrderWithItems | null;
            if (order && ["preparing", "ready"].includes(order.status)) {
              setOrders((prev) => [...prev, order]);
              playChime();
              if (autoPrintRef.current) setTimeout(() => printKitchenSlip(order), 400);
            }
          }

          if (payload.eventType === "UPDATE") {
            const updated = payload.new as OrderRow;
            if (updated.status === "completed" || updated.status === "failed") {
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
                  playChime();
                  if (autoPrintRef.current) setTimeout(() => printKitchenSlip(order), 400);
                  return [...prev, order];
                });
              }
            } else {
              setOrders((prev) => prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o));
            }
          }
        }
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  async function handleAdvance(orderId: string, newStatus: "ready" | "completed") {
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
        <div>
          <p className="font-black text-base leading-tight">°Celsius Orders</p>
          <p className="text-white/50 text-xs">{session.storeName}</p>
        </div>

        <div className="flex items-center gap-2">
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
            : <WifiOff className="h-4 w-4 text-red-400 animate-pulse" />
          }
        </div>
      </header>

      {/* Tabs + stats */}
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

        {tab === "active" && (
          <div className="px-4 py-1.5 flex items-center gap-4 border-t border-border/30">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-bold">{preparing.length}</span>
              <span className="text-xs text-muted-foreground">preparing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-bold">{ready.length}</span>
              <span className="text-xs text-muted-foreground">ready</span>
            </div>
          </div>
        )}
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
