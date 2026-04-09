"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, MapPin, CheckCircle2, Clock, ChevronRight } from "lucide-react";

const ArrowRight = ChevronRight;
import { getSupabaseClient } from "@/lib/supabase/client";
import { useCartStore } from "@/store/cart";
import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

// ── Swipe-to-receive component ─────────────────────────────────────────────
function SwipeToReceive({ onComplete }: { onComplete: () => void }) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const thumbRef  = useRef<HTMLDivElement>(null);
  const [pct, setPct]         = useState(0);
  const [done, setDone]       = useState(false);
  const startX   = useRef(0);
  const dragging = useRef(false);

  const handleStart = useCallback((clientX: number) => {
    dragging.current = true;
    startX.current   = clientX;
  }, []);

  const handleMove = useCallback((clientX: number) => {
    if (!dragging.current || !trackRef.current) return;
    const trackW = trackRef.current.clientWidth;
    const thumbW = 56; // thumb width px
    const maxDrag = trackW - thumbW - 8; // 4px padding each side
    const delta  = Math.max(0, Math.min(clientX - startX.current, maxDrag));
    setPct(delta / maxDrag);
  }, []);

  const handleEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (pct >= 0.85) {
      setPct(1);
      setDone(true);
      setTimeout(onComplete, 500);
    } else {
      setPct(0);
    }
  }, [pct, onComplete]);

  return (
    <div
      ref={trackRef}
      className="relative w-full h-14 rounded-2xl flex items-center select-none overflow-hidden"
      style={{ background: "rgba(255,255,255,0.15)" }}
      onMouseDown={(e) => handleStart(e.clientX)}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={(e) => handleStart(e.touches[0].clientX)}
      onTouchMove={(e) => { e.preventDefault(); handleMove(e.touches[0].clientX); }}
      onTouchEnd={handleEnd}
    >
      {/* Fill track */}
      <div
        className="absolute inset-y-0 left-0 rounded-2xl transition-none"
        style={{ width: `${4 + pct * 92}%`, background: "rgba(255,255,255,0.15)" }}
      />
      {/* Label */}
      <span
        className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/70 pointer-events-none"
        style={{ opacity: 1 - pct * 2 }}
      >
        {done ? "✓ Received!" : "Swipe to confirm pickup →"}
      </span>
      {/* Thumb */}
      <div
        ref={thumbRef}
        className="absolute left-1 w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing transition-none"
        style={{ transform: `translateX(${pct * (((trackRef.current?.clientWidth ?? 200) - 56 - 8))  }px)` }}
      >
        <ArrowRight className="h-5 w-5 text-emerald-600" />
      </div>
    </div>
  );
}

function OrderReadyScreen({ order, onDone }: { order: OrderRow & { order_items: OrderItemRow[] }; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(order.status === "completed");
  // Generate a short claim reference: order number + last 4 of payment ref
  const claimRef = `C-${order.order_number}`;

  function handleClaim() {
    setConfirmed(true);
    // Mark as completed on backend (fire-and-forget)
    fetch(`/api/orders/${order.id}/status`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: "completed" }),
    }).catch(() => {});
  }

  // Post-swipe "claimed" screen
  if (confirmed) {
    return (
      <div className="flex flex-col min-h-dvh bg-[#160800] items-center justify-center text-center px-6">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-5">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-[0.2em] mb-1">Pickup Confirmed</p>
          <p className="text-white/40 text-xs mb-8">Thank you — enjoy your order!</p>

          {/* Claim reference card */}
          <div className="bg-white/8 rounded-2xl px-8 py-6 w-full" style={{ background: "rgba(255,255,255,0.07)" }}>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-2">Claim Reference</p>
            <p className="font-black text-white text-4xl tracking-wider">{claimRef}</p>
            <p className="text-white/30 text-xs mt-3 capitalize">
              Celsius {order.store_id.replace(/-/g, " ")} · {new Date().toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>

        <div className="pb-14 w-full space-y-2">
          <button
            onClick={onDone}
            className="w-full bg-white/10 text-white font-bold rounded-2xl py-4 text-sm"
          >
            View Order History
          </button>
          <Link
            href="/store"
            className="block w-full bg-white/6 text-white/50 font-semibold rounded-2xl py-4 text-sm text-center"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            Order Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-emerald-600 items-center justify-center text-center px-6">
      <div className="flex-1 flex flex-col items-center justify-center">
        <p className="text-white/70 text-xs font-bold uppercase tracking-[0.2em] mb-2">
          Your order is ready!
        </p>
        <p className="text-white/60 text-xs mb-5">Show this to the barista</p>
        <p
          className="font-black text-white leading-none"
          style={{ fontSize: "clamp(72px, 22vw, 120px)" }}
        >
          #{order.order_number}
        </p>
        <div className="flex items-center gap-1.5 mt-5 text-white/50 text-xs">
          <MapPin className="h-3.5 w-3.5" />
          <span className="capitalize">Celsius {order.store_id.replace(/-/g, " ")}</span>
        </div>
      </div>

      <div className="pb-14 w-full space-y-3">
        <SwipeToReceive onComplete={handleClaim} />
        <Link
          href="/store"
          className="block w-full bg-white/15 text-white font-semibold rounded-2xl py-4 text-sm text-center"
        >
          Order Again
        </Link>
      </div>
    </div>
  );
}

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

function playChime() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(523, ctx.currentTime);
    osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.9);
  } catch { /* ignore */ }
}

export default function OrderTrackingPage() {
  const params       = useParams();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const orderId      = params.orderId as string;
  const clearCart    = useCartStore((s) => s.clearCart);

  const [order,   setOrder]   = useState<OrderWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  // Track whether we played the "ready" chime already
  const [chimePlayed, setChimePlayed] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    fetch(`/api/orders/${orderId}`)
      .then((r) => r.json())
      .then((data: OrderWithItems) => {
        setOrder(data);
        setLoading(false);

        const redirectStatus  = searchParams.get("redirect_status");
        const isPaymentReturn = searchParams.get("payment") === "done";
        const paymentIntentId = searchParams.get("payment_intent");

        // Clear cart on payment return (unless payment failed)
        if (isPaymentReturn && redirectStatus !== "failed" && data?.status !== "failed") {
          clearCart();
        }

        // FPX redirect fallback: confirm server-side if order still pending
        if (
          isPaymentReturn &&
          redirectStatus === "succeeded" &&
          paymentIntentId &&
          data?.status === "pending"
        ) {
          fetch(`/api/orders/${orderId}/confirm-stripe`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ paymentIntentId }),
          })
            .then((r) => r.json())
            .then((result: { confirmed?: boolean }) => {
              if (result.confirmed) {
                setOrder((prev) => prev ? { ...prev, status: "preparing" } : null);
              }
            })
            .catch(() => {});
        }

        // Play chime if order already ready when page loads
        if (data?.status === "ready") {
          playChime();
          setChimePlayed(true);
        }
      })
      .catch(() => setLoading(false));
  }, [orderId, clearCart, searchParams]);

  // Realtime: listen for status changes
  useEffect(() => {
    if (!orderId) return;
    const supabase = getSupabaseClient();
    const channel  = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => {
          const updated = payload.new as OrderRow;
          setOrder((prev) => prev ? { ...prev, ...updated } : null);
          // Chime + vibrate when staff marks order ready
          if (updated.status === "ready" && !chimePlayed) {
            playChime();
            setChimePlayed(true);
            try { navigator.vibrate([80, 40, 160]); } catch { /* ignore */ }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orderId, chimePlayed]);

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center bg-[#160800]">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    );
  }

  // ── NOT FOUND ──────────────────────────────────────────────────────────────
  if (!order || !order.id) {
    return (
      <div className="flex flex-col min-h-dvh bg-[#160800] items-center justify-center text-center px-8">
        <AlertCircle className="h-10 w-10 text-white/30 mb-4" />
        <h1 className="text-lg font-bold text-white">Order Not Found</h1>
        <p className="text-white/40 text-sm mt-1">This link may be invalid or expired</p>
        <Link href="/" className="mt-8 bg-white/10 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
          Back to Home
        </Link>
      </div>
    );
  }

  // ── PAYMENT FAILED ────────────────────────────────────────────────────────
  if (order.status === "failed") {
    return (
      <div className="flex flex-col min-h-dvh bg-red-700 items-center justify-center text-center px-8">
        <AlertCircle className="h-10 w-10 text-white/70 mb-4" />
        <h1 className="text-lg font-bold text-white">Payment Failed</h1>
        <p className="text-white/60 text-sm mt-1">Your order was not charged</p>
        <Link href="/cart" className="mt-8 bg-white/20 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
          Back to Cart
        </Link>
      </div>
    );
  }

  // ── PENDING PAYMENT ────────────────────────────────────────────────────────
  if (order.status === "pending") {
    return (
      <div className="flex flex-col min-h-dvh bg-[#160800] items-center justify-center text-center px-8">
        <Loader2 className="h-8 w-8 text-white/30 animate-spin mb-4" />
        <h1 className="text-lg font-bold text-white">Awaiting Payment</h1>
        <p className="text-white/40 text-sm mt-1">Your order will appear once payment is confirmed</p>
        <Link href="/account/orders" className="mt-8 bg-white/10 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
          View Orders
        </Link>
      </div>
    );
  }

  // ── ORDER READY — swipe to confirm pickup ────────────────────────────────
  if (order.status === "ready" || order.status === "completed") {
    return (
      <OrderReadyScreen
        order={order}
        onDone={() => router.push("/account/orders?tab=history")}
      />
    );
  }

  // ── ORDER CONFIRMED / PREPARING (paid or preparing status) ────────────────
  const totalRM = (order.total / 100).toFixed(2);

  return (
    <div className="flex flex-col min-h-dvh bg-[#160800]">
      {/* Payment confirmed header */}
      <div className="pt-14 pb-6 px-5 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
        </div>
        <h1 className="text-xl font-black text-white">Payment Confirmed</h1>
        <p className="text-white/50 text-sm mt-1">Order #{order.order_number}</p>
      </div>

      {/* Status bar */}
      <div className="mx-5 mb-4 bg-white/8 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div className="w-8 h-8 rounded-full bg-amber-400/20 flex items-center justify-center shrink-0">
          <Clock className="h-4 w-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold">Being prepared</p>
          <p className="text-white/40 text-xs mt-0.5">We'll notify you when it's ready</p>
        </div>
      </div>

      {/* Order details */}
      <div className="mx-5 flex-1">
        <div className="bg-white/8 rounded-2xl px-5 py-5 space-y-4" style={{ background: "rgba(255,255,255,0.07)" }}>
          {/* Outlet */}
          <div className="flex items-center gap-1.5 text-white/40 text-sm">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="capitalize font-medium">Celsius {order.store_id.replace(/-/g, " ")}</span>
          </div>

          {/* Items list */}
          <div className="space-y-3">
            {(order.order_items ?? []).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-white/40 text-sm font-semibold w-5 text-right shrink-0">
                    {item.quantity}×
                  </span>
                  <span className="text-white text-sm font-semibold truncate">
                    {item.product_name}
                  </span>
                </div>
                <span className="text-white/60 text-sm shrink-0">
                  RM {(item.unit_price * item.quantity / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="border-t border-white/10 pt-4 flex justify-between items-center">
            <span className="text-white/50 text-sm font-semibold">Total</span>
            <span className="text-white font-black text-lg">RM {totalRM}</span>
          </div>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="px-5 pt-5 pb-12 space-y-2 mt-4">
        <button
          onClick={() => router.push("/account/orders?tab=history")}
          className="w-full flex items-center justify-center gap-2 bg-white/10 text-white font-semibold rounded-2xl py-4 text-sm"
        >
          View Order History <ChevronRight className="h-4 w-4" />
        </button>
        <Link
          href="/store"
          className="block w-full bg-white/6 text-white/60 font-semibold rounded-2xl py-4 text-sm text-center"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          Order Again
        </Link>
      </div>
    </div>
  );
}
