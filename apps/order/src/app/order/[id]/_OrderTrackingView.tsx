"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShoppingBag, Coffee, CheckCircle2, XCircle } from "lucide-react";
import { MysteryReward } from "./_MysteryReward";
import { clearDineInCart, getPendingOrder } from "@/lib/checkout-session";

type OrderItem = {
  product_name: string;
  quantity: number;
  item_total: number;
  modifiers?: {
    selections?: Array<{ label?: string }>;
    specialInstructions?: string;
  } | null;
};

type Order = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  subtotal: number;
  payment_method: string;
  notes?: string | null;
  created_at: string;
  order_items?: OrderItem[];
  store_id?: string | null;
  store_name?: string | null;
  store_address?: string | null;
  order_type?: string | null;
  table_number?: string | null;
  reward_discount_amount?: number | null;
  reward_name?: string | null;
  discount_amount?: number | null;
  first_order_discount_amount?: number | null;
  promo_discount?: number | null;
  sst_amount?: number | null;
  loyalty_points_earned?: number | null;
};

function rm(cents: number | null | undefined): string {
  return `RM${((cents ?? 0) / 100).toFixed(2)}`;
}

// RM Direct-mode payment methods whose confirmation rides on a best-effort
// webhook. Kept in sync with the same set in /api/cron/reconcile-pending and
// /api/payments/poll so the on-screen backstop covers exactly those methods.
const RM_METHODS = new Set(["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card"]);

// Horizontal 3-step pipeline matching apps/pickup-native/components
// /OrderStepper.tsx. The final step reads "Ready / Pick up now" for
// pickup and "Served / Enjoy!" for dine-in (table orders).
function stepperSteps(dineIn: boolean): Array<{ title: string; sub: string; Icon: typeof ShoppingBag }> {
  return [
    { title: "Received", sub: "Order placed", Icon: ShoppingBag },
    { title: "Brewing", sub: "Being prepared", Icon: Coffee },
    dineIn
      ? { title: "Served", sub: "Enjoy!", Icon: CheckCircle2 }
      : { title: "Ready", sub: "Pick up now", Icon: CheckCircle2 },
  ];
}

function stepperIndex(status: string): number {
  const s = status.toLowerCase();
  if (s === "preparing") return 1;
  if (s === "ready" || s === "completed" || s === "collected") return 2;
  return 0;
}

export function OrderTrackingView({
  orderId,
  justPaid = false,
}: {
  orderId: string;
  /** True when the customer landed via the gateway's …?payment=done
   *  redirect — i.e. they JUST completed payment, even if the order row
   *  still reads pending or failed (FPX settlement lag, or a failed-then-
   *  repaid order the reconcile is about to heal). Drives the amber
   *  "Confirming payment" treatment instead of a red failed card. */
  justPaid?: boolean;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Confirming window: opens when the customer arrives with payment=done
  // and the order isn't settled yet; closes after 90s so a genuinely
  // failed payment can't hide behind "confirming" forever. The RM poll
  // below keeps running either way.
  const [confirmWindow, setConfirmWindow] = useState(justPaid);
  useEffect(() => {
    if (!confirmWindow) return;
    const t = window.setTimeout(() => setConfirmWindow(false), 90_000);
    return () => window.clearTimeout(t);
  }, [confirmWindow]);
  // "Payment confirmed ✓" acknowledgement — shown briefly when we watch
  // the order settle (pending/failed → preparing/paid/ready) so the flip
  // to Brewing reads as a response to the customer's payment instead of
  // the screen silently swapping (the C-5760 complaint). Transition
  // detection lives in the fetch callback (where new server state lands),
  // not an effect, so it can't cascade renders.
  const prevStatusRef = useRef<string | null>(null);
  const [showPaymentConfirmed, setShowPaymentConfirmed] = useState(false);

  const fetchOrder = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/${orderId}`);
      const data = await r.json();
      const next: Order | null = data?.order ?? (data?.id ? (data as Order) : null);
      if (!next) return;
      const cur = next.status?.toLowerCase() ?? null;
      const prev = prevStatusRef.current;
      if (
        prev && cur && prev !== cur &&
        (prev === "pending" || prev === "failed") &&
        ["preparing", "paid", "ready"].includes(cur)
      ) {
        setShowPaymentConfirmed(true);
        window.setTimeout(() => setShowPaymentConfirmed(false), 5000);
      }
      prevStatusRef.current = cur;
      setOrder(next);
    } catch (err) {
      setError(String(err));
    }
  }, [orderId]);

  // DB status poll — reflects whatever flipped the order server-side.
  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) void fetchOrder(); };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fetchOrder]);

  // Active RM reconcile backstop. RM Direct-mode webhooks are best-effort
  // (and signature validation has been bouncing valid callbacks), so a
  // card / FPX / e-wallet order can sit `pending` until the 5-min
  // reconcile-pending cron — the kitchen docket only prints once it flips
  // to `preparing`. While the customer is on this screen with a pending RM
  // order (they land here via the …?payment=done redirect right after
  // paying), ask the server to query RM directly so it settles in seconds
  // instead of minutes. Mirrors the native backstop in
  // apps/pickup-native/app/order/[id].tsx. Keyed on status+method so it
  // only runs while unsettled and tears down the moment it settles.
  //
  // "failed" keeps polling too: a customer can retry payment on the same
  // order after a failed attempt (C-9782 — card expired, FPX retry paid a
  // minute later), so RM can flip a failed checkout to SUCCESS. Server-side
  // reconcile accepts failed → paid, and this poll is what lets the customer
  // watch their "Payment failed" screen heal into "Brewing now".
  const status = order?.status;
  const method = order?.payment_method;
  useEffect(() => {
    if ((status !== "pending" && status !== "failed") || !method || !RM_METHODS.has(method)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/payments/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const json = (await res.json().catch(() => null)) as { status?: string } | null;
        // Reflect a status change immediately rather than waiting for the
        // next 5s DB tick. Compared against the current status so a failed
        // order that stays failed doesn't refetch on every 3s tick.
        if (!cancelled && json?.status && json.status !== status) {
          void fetchOrder();
        }
      } catch {
        // Network blip — the next tick retries.
      }
    };
    void poll();
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status, method, orderId, fetchOrder]);

  // Clear the cart ONLY once THIS just-placed order is confirmed paid. This is
  // the single confirmed-payment clear point for the gateway-redirect methods
  // (card / FPX / e-wallets land back here via ?payment=done). Guarded on the
  // pending-order breadcrumb so viewing an old order from history never wipes a
  // fresh in-progress cart.
  useEffect(() => {
    const st = String(status ?? "").toLowerCase();
    if (!["preparing", "paid", "ready", "completed", "collected"].includes(st)) return;
    if (getPendingOrder()?.orderId === orderId) clearDineInCart();
  }, [status, orderId]);

  if (!order) {
    return (
      <>
        <Header />
        <div className="p-8 text-center text-[#8E8E93] text-sm">
          {error ? `Failed to load order: ${error}` : "Loading order…"}
        </div>
      </>
    );
  }

  const stepIdx = stepperIndex(order.status);
  const isDineIn = order.order_type === "dine_in";
  const STEPPER = stepperSteps(isDineIn);

  return (
    <>
      <Header />

      <section className="px-4 pt-4">
        <p className="text-[10px] uppercase tracking-widest text-[#8E8E93]">Order</p>
        <h1 className="font-peachi font-bold text-2xl mt-1">#{order.order_number}</h1>
      </section>

      {order.store_name ? (
        <section className="px-4 pt-5">
          <h2 className="font-peachi font-bold text-[16px] mb-1">
            {isDineIn ? "Dine-in" : "Pickup from"}
          </h2>
          <p className="text-sm font-peachi font-bold">
            {isDineIn && order.table_number
              ? `Table ${order.table_number} · ${order.store_name}`
              : order.store_name}
          </p>
          {order.store_address ? (
            <p className="text-[12px] text-[#6E6E73] mt-0.5">{order.store_address}</p>
          ) : null}
        </section>
      ) : null}

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Status</h2>
        {showPaymentConfirmed ? (
          <div className="flex items-center gap-3 rounded-2xl bg-green-50 border border-green-200 p-3 mb-3">
            <CheckCircle2 size={20} color="#15803D" />
            <div>
              <p className="font-peachi font-bold text-sm text-green-800">Payment confirmed</p>
              <p className="text-[12px] text-green-700 mt-0.5">
                We&rsquo;ve started on your order.
              </p>
            </div>
          </div>
        ) : null}
        {(order.status.toLowerCase() === "failed" || order.status.toLowerCase() === "pending") &&
        confirmWindow &&
        RM_METHODS.has(order.payment_method) ? (
          // The customer just came back from the gateway (?payment=done)
          // but the row hasn't settled yet — FPX settlement lag, or a
          // failed-then-repaid order reconcile is healing. Showing the
          // red "Payment failed" card here right after their bank said
          // "paid" is alarming and invites a double payment; show the
          // checking state instead. The poll flips this the moment the
          // server confirms (or the 90s window lapses back to truth).
          <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 p-3">
            <span
              className="inline-block flex-shrink-0 rounded-full border-2 border-amber-600 border-t-transparent animate-spin"
              style={{ width: 20, height: 20 }}
            />
            <div>
              <p className="font-peachi font-bold text-sm text-amber-800">Confirming payment…</p>
              <p className="text-[12px] text-amber-700 mt-0.5">
                We&rsquo;re checking with your bank — usually a few seconds. Please
                don&rsquo;t pay again; this page updates automatically.
              </p>
            </div>
          </div>
        ) : order.status.toLowerCase() === "failed" || order.status.toLowerCase() === "cancelled" ? (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 p-3">
            <XCircle size={20} color="#B91C1C" />
            <div>
              <p className="font-peachi font-bold text-sm text-red-800">
                {order.status === "failed" ? "Payment failed" : "Cancelled"}
              </p>
              <p className="text-[12px] text-red-700 mt-0.5">
                {order.status === "failed"
                  ? "Place the order again to retry."
                  : "This order was cancelled."}
              </p>
              {order.status === "failed" && RM_METHODS.has(order.payment_method) ? (
                <p className="text-[12px] text-red-700 mt-1">
                  Just paid? Hang tight — we re-check with the bank automatically
                  and this page will update.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          // Horizontal 3-step pipeline. Done steps fill terracotta-tint,
          // current step pulses with a subtle scale animation, pending
          // steps stay hollow. Connected by hairline rails that fill
          // when the step before them is done.
          <div>
            {/* Rail — icons sit at 0% / 50% / 100% with the connectors filling
                between them, so the first step hugs the left edge and the last
                hugs the right (aligned with the cards above/below) instead of
                the last node floating two-thirds in. */}
            <div className="flex items-center">
              {STEPPER.map((step, i) => {
                const isLast = i === STEPPER.length - 1;
                const state =
                  i < stepIdx ? "done" : i === stepIdx ? "current" : "pending";
                const bg =
                  state === "done"
                    ? "#FBEBE8"
                    : state === "current"
                    ? "#A2492C"
                    : "#FFFFFF";
                const iconColor =
                  state === "done"
                    ? "#A2492C"
                    : state === "current"
                    ? "#FFFFFF"
                    : "#8E8E93";
                const border =
                  state === "pending" ? "1px solid rgba(26,2,0,0.12)" : "none";
                const Icon = step.Icon;
                return (
                  <Fragment key={step.title}>
                    <span
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: bg,
                        border,
                        animation:
                          state === "current"
                            ? "celsius-step-pulse 1.4s ease-in-out infinite"
                            : undefined,
                      }}
                    >
                      <Icon
                        size={18}
                        color={iconColor}
                        strokeWidth={state === "current" ? 2.2 : 1.8}
                      />
                    </span>
                    {!isLast ? (
                      <span
                        className="flex-1"
                        style={{
                          height: 2,
                          marginLeft: 4,
                          marginRight: 4,
                          backgroundColor:
                            i < stepIdx ? "#A2492C" : "rgba(26,2,0,0.10)",
                        }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            {/* Labels — each tracks its node: first left-aligned, middle
                centred, last right-aligned, so they line up under the icons
                across the full width. */}
            <div className="flex items-start mt-2.5">
              {STEPPER.map((step, i) => {
                const isLast = i === STEPPER.length - 1;
                const state =
                  i < stepIdx ? "done" : i === stepIdx ? "current" : "pending";
                return (
                  <div
                    key={step.title}
                    className="flex-1 min-w-0"
                    style={{
                      textAlign: i === 0 ? "left" : isLast ? "right" : "center",
                    }}
                  >
                    <p
                      className="uppercase truncate"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 1.5,
                        color:
                          state === "current"
                            ? "#A2492C"
                            : state === "done"
                            ? "#1A0200"
                            : "#8E8E93",
                      }}
                    >
                      {step.title}
                    </p>
                    <p
                      className="truncate"
                      style={{
                        fontSize: 11,
                        marginTop: 2,
                        fontWeight: 500,
                        color: state === "current" ? "#A2492C" : "#8E8E93",
                      }}
                    >
                      {step.sub}
                    </p>
                  </div>
                );
              })}
            </div>
            <style>{`
              @keyframes celsius-step-pulse {
                0%, 100% { transform: scale(1); }
                50%      { transform: scale(1.12); }
              }
            `}</style>
          </div>
        )}
      </section>

      {/* Mystery-bean reveal — only once payment is in (not pending /
          failed / cancelled). Renders nothing if the order has no drop. */}
      {["paid", "preparing", "ready", "completed", "collected"].includes(
        order.status.toLowerCase(),
      ) ? (
        <MysteryReward
          orderId={orderId}
          baseBeansEarned={order.loyalty_points_earned ?? undefined}
        />
      ) : null}

      <section className="px-4 pt-5">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26, 2, 0, 0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Items
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {(order.order_items ?? []).map((it, i) => {
              const labels = (it.modifiers?.selections ?? [])
                .map((s) => s?.label)
                .filter((l): l is string => !!l);
              const note = it.modifiers?.specialInstructions?.trim() || null;
              return (
                <li key={i} className="flex flex-col" style={{ gap: 2 }}>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#1A0200] flex-1 pr-2">
                      {it.quantity}× {it.product_name}
                    </span>
                    <span className="text-[#1A0200]">{rm(it.item_total)}</span>
                  </div>
                  {labels.length > 0 ? (
                    <p
                      className="line-clamp-2"
                      style={{ color: "#6B6B6B", fontSize: 12, paddingRight: 60 }}
                    >
                      {labels.join(" · ")}
                    </p>
                  ) : null}
                  {note ? (
                    <p
                      className="line-clamp-2 italic"
                      style={{ color: "#6B6B6B", fontSize: 12, paddingRight: 60 }}
                    >
                      &ldquo;{note}&rdquo;
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 pt-3 border-t border-[rgba(26,2,0,0.10)] flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-[#6B6B6B]">Subtotal</span>
              <span className="text-[#1A0200]">{rm(order.subtotal)}</span>
            </div>
            {order.reward_discount_amount && order.reward_discount_amount > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-[#A2492C] truncate pr-2">
                  Reward{order.reward_name ? ` · ${order.reward_name}` : ""}
                </span>
                <span className="text-[#A2492C]">−{rm(order.reward_discount_amount)}</span>
              </div>
            ) : null}
            {order.discount_amount && order.discount_amount > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-[#A2492C]">Voucher</span>
                <span className="text-[#A2492C]">−{rm(order.discount_amount)}</span>
              </div>
            ) : null}
            {order.first_order_discount_amount && order.first_order_discount_amount > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-[#A2492C]">First-order discount</span>
                <span className="text-[#A2492C]">−{rm(order.first_order_discount_amount)}</span>
              </div>
            ) : null}
            {order.promo_discount && order.promo_discount > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-[#A2492C]">Promo</span>
                <span className="text-[#A2492C]">−{rm(order.promo_discount)}</span>
              </div>
            ) : null}
            {order.sst_amount && order.sst_amount > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6B6B6B]">SST</span>
                <span className="text-[#6B6B6B]">{rm(order.sst_amount)}</span>
              </div>
            ) : null}
            <div className="mt-1 pt-2 border-t border-[rgba(26,2,0,0.10)] flex items-baseline justify-between">
              <span className="font-peachi font-bold text-[#1A0200]" style={{ fontSize: 15 }}>
                Total
              </span>
              <span className="font-peachi font-bold text-[#A2492C]" style={{ fontSize: 22 }}>
                {rm(order.total)}
              </span>
            </div>
            {order.total === 0 &&
            ["paid", "preparing", "ready", "completed", "collected"].includes(
              order.status.toLowerCase(),
            ) ? (
              <p
                className="mt-2 text-center"
                style={{ color: "#A2492C", fontSize: 12, fontWeight: 600 }}
              >
                No payment needed — enjoy! ☕
              </p>
            ) : null}
            {order.loyalty_points_earned && order.loyalty_points_earned > 0 ? (
              <p
                className="mt-1 text-right"
                style={{ color: "#A2492C", fontSize: 12, fontWeight: 700 }}
              >
                +{order.loyalty_points_earned} Points earned
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

function Header() {
  return (
    <header
      className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <Link href="/orders" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
        <ArrowLeft size={20} color="#FFFFFF" />
      </Link>
      <h1 className="font-peachi font-bold text-[22px]">Order</h1>
    </header>
  );
}
