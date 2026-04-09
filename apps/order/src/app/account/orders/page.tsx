"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Coffee, ShoppingCart, RotateCcw, Clock, MapPin,
  ChevronRight, Loader2,
} from "lucide-react";
import { useCartStore } from "@/store/cart";
import { getSupabaseClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/bottom-nav";
import type { Product, CartItemModifiers } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: number;   // sen
  quantity: number;
  item_total: number;   // sen
  modifiers: {
    selections?: { groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }[];
    specialInstructions?: string;
  };
}

interface OrderSummary {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  total: number;        // sen
  created_at: string;
  order_items: OrderItem[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["pending", "paid", "preparing", "ready"]);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pending",  cls: "bg-amber-100 text-amber-700" },
  paid:      { label: "Paid",     cls: "bg-blue-100 text-blue-700" },
  preparing: { label: "Making",   cls: "bg-orange-100 text-orange-700" },
  ready:     { label: "Pickup",   cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Finished", cls: "bg-gray-100 text-gray-500" },
  failed:    { label: "Failed",   cls: "bg-red-100 text-red-600" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function storeName(storeId: string) {
  return "Celsius " + storeId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-MY", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ─── Order Card ──────────────────────────────────────────────────────────────

function OrderCard({
  order,
  showReorder,
  onReorder,
}: {
  order: OrderSummary;
  showReorder: boolean;
  onReorder: (o: OrderSummary) => void;
}) {
  const badge   = STATUS_BADGE[order.status] ?? { label: order.status, cls: "bg-gray-100 text-gray-500" };
  const isActive = ACTIVE_STATUSES.has(order.status);
  const totalRM  = (order.total / 100).toFixed(2);
  const items    = order.order_items ?? [];

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm">

      {/* ── Header row ── */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-sm font-bold text-[#160800] truncate">
              {storeName(order.store_id)}
            </span>
          </div>
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{fmtDate(order.created_at)} · {fmtTime(order.created_at)}</span>
          <span className="text-border">·</span>
          <span>#{order.order_number}</span>
        </div>
      </div>

      {/* ── Items ── */}
      <div className="divide-y divide-border/30">
        {items.slice(0, 4).map((item) => {
          const mods = (item.modifiers.selections ?? []).map((s) => s.label).join(" · ");
          return (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3">
              {/* Placeholder thumbnail */}
              <div className="w-11 h-11 rounded-xl bg-[#f5f5f5] flex items-center justify-center shrink-0">
                <Coffee className="h-5 w-5 text-primary/50" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#160800] truncate">{item.product_name}</p>
                {mods && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{mods}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">×{item.quantity}</p>
                <p className="text-xs font-semibold text-[#160800]">
                  RM {(item.item_total / 100).toFixed(2)}
                </p>
              </div>
            </div>
          );
        })}
        {items.length > 4 && (
          <div className="px-4 py-2.5">
            <p className="text-xs text-muted-foreground">
              +{items.length - 4} more item{items.length - 4 > 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-border/40 flex items-center justify-between bg-[#fafafa]">
        <div>
          <p className="text-xs text-muted-foreground">Total paid</p>
          <p className="text-sm font-bold text-[#160800]">RM {totalRM}</p>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <Link
              href={`/order/${order.id}`}
              className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-full"
            >
              Pickup Now <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {showReorder && (
            <button
              onClick={() => onReorder(order)}
              className="flex items-center gap-1.5 bg-[#160800] text-white text-xs font-semibold px-4 py-2 rounded-full active:opacity-80 transition-opacity"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Order Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const recentOrders  = useCartStore((s) => s.recentOrders);
  const loyaltyMember = useCartStore((s) => s.loyaltyMember);
  const addItem       = useCartStore((s) => s.addItem);

  const [orders,   setOrders]   = useState<OrderSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<"current" | "history">(
    searchParams.get("tab") === "history" ? "history" : "current"
  );
  const [toast,    setToast]    = useState(false);
  const channelsRef             = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]>[]>([]);

  useEffect(() => {
    async function load() {
      // If loyalty member is logged in, fetch all orders by phone from DB
      if (loyaltyMember?.phone) {
        try {
          const res = await fetch(`/api/orders?phone=${encodeURIComponent(loyaltyMember.phone)}`);
          if (res.ok) {
            const data = (await res.json()) as OrderSummary[];
            data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            setOrders(data);
            setLoading(false);
            return;
          }
        } catch { /* fall through to recentOrders */ }
      }

      // Fallback: fetch individual orders from localStorage recentOrders
      if (!recentOrders.length) { setLoading(false); return; }

      const results = await Promise.allSettled(
        recentOrders.map((o) =>
          fetch(`/api/orders/${o.orderId}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      );
      const fetched = results
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter(Boolean) as OrderSummary[];
      fetched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setOrders(fetched);
      setLoading(false);
    }
    load();
  }, [recentOrders, loyaltyMember]);

  // Realtime: subscribe to status changes on all active orders
  useEffect(() => {
    const activeIds = orders
      .filter((o) => ACTIVE_STATUSES.has(o.status))
      .map((o) => o.id);

    // Clean up previous channels
    const supabase = getSupabaseClient();
    channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelsRef.current = [];

    if (!activeIds.length) return;

    // One channel per active order (Supabase filter supports only eq per channel)
    activeIds.forEach((id) => {
      const ch = supabase
        .channel(`orders-list-${id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
          (payload) => {
            const updated = payload.new as OrderSummary;
            setOrders((prev) =>
              prev.map((o) => (o.id === id ? { ...o, ...updated } : o))
            );
          }
        )
        .subscribe();
      channelsRef.current.push(ch);
    });

    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [orders.map((o) => o.id + o.status).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconstruct cart items from stored order data and push to cart
  function handleReorder(order: OrderSummary) {
    for (const item of order.order_items ?? []) {
      const priceDeltaSum = (item.modifiers.selections ?? [])
        .reduce((sum, m) => sum + m.priceDelta, 0);

      const product: Product = {
        id:             item.product_id,
        categoryId:     "",
        name:           item.product_name,
        basePrice:      Math.max(0, item.unit_price / 100 - priceDeltaSum),
        image:          "",
        variants:       [],
        modifierGroups: [],
        isAvailable:    true,
      };

      const modifiers: CartItemModifiers = {
        selections:          item.modifiers.selections ?? [],
        specialInstructions: item.modifiers.specialInstructions,
      };

      // Add once per unit of quantity
      for (let q = 0; q < item.quantity; q++) {
        addItem(product, modifiers);
      }
    }

    setToast(true);
    setTimeout(() => setToast(false), 2500);
    router.push("/cart");
  }

  const currentOrders = orders.filter((o) =>  ACTIVE_STATUSES.has(o.status));
  const historyOrders = orders.filter((o) => !ACTIVE_STATUSES.has(o.status));
  const displayed     = tab === "current" ? currentOrders : historyOrders;

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">

      {/* ── Header + Tabs ── */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 pt-12 pb-3">
          <button onClick={() => router.back()} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold flex-1 text-center">Orders</h1>
          <div className="w-7" />
        </div>

        <div className="flex border-t border-border/30">
          {(["current", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t
                  ? "border-[#160800] text-[#160800]"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {t === "current" ? "Current Orders" : "Purchase History"}
              {t === "current" && currentOrders.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold leading-none">
                  {currentOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 px-4 py-4 space-y-3 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading orders…</p>
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Coffee className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <div>
              <p className="font-bold text-base">
                {tab === "current" ? "No active orders" : "No past orders"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {tab === "current"
                  ? "Active orders will appear here"
                  : "Completed orders will appear here"}
              </p>
            </div>
            <Link
              href="/menu"
              className="mt-2 bg-[#160800] text-white rounded-full px-6 py-3 text-sm font-semibold"
            >
              Start an Order
            </Link>
          </div>
        ) : (
          displayed.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              showReorder={tab === "history" && order.status !== "failed"}
              onReorder={handleReorder}
            />
          ))
        )}

        {displayed.length > 0 && (
          <p className="text-center text-xs text-muted-foreground pb-2">
            {loyaltyMember?.phone ? "All your orders" : "Orders placed on this device"}
          </p>
        )}
      </main>

      {/* ── Cart toast ── */}
      {toast && (
        <div className="fixed bottom-24 inset-x-4 max-w-[398px] mx-auto z-50 pointer-events-none">
          <div className="bg-[#160800] text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl">
            <ShoppingCart className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">Items added — heading to cart</p>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
