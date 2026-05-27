"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, Coffee, Package, XCircle, X } from "lucide-react";

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

const STEPS: Array<{ key: string; label: string; Icon: typeof Clock }> = [
  { key: "pending",    label: "Awaiting payment", Icon: Clock },
  { key: "paid",       label: "Payment confirmed", Icon: CheckCircle2 },
  { key: "preparing",  label: "Preparing",         Icon: Coffee },
  { key: "ready",      label: "Ready for pickup",  Icon: Package },
  { key: "completed",  label: "Collected",         Icon: CheckCircle2 },
];

export function OrderTrackingView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (res.ok) {
        setOrder((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't cancel the order");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchOrder = () => {
      fetch(`/api/orders/${orderId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data?.order) setOrder(data.order as Order);
          else if (data?.id) setOrder(data as Order);
        })
        .catch((err) => !cancelled && setError(String(err)));
    };
    fetchOrder();
    const id = window.setInterval(fetchOrder, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [orderId]);

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

  const stepIdx = STEPS.findIndex((s) => s.key === order.status.toLowerCase());

  return (
    <>
      <Header />

      <section className="px-4 pt-4">
        <p className="text-[10px] uppercase tracking-widest text-[#8E8E93]">Order</p>
        <h1 className="font-peachi font-bold text-2xl mt-1">#{order.order_number}</h1>
      </section>

      {order.store_name ? (
        <section className="px-4 pt-5">
          <h2 className="font-peachi font-bold text-[16px] mb-1">Pickup from</h2>
          <p className="text-sm font-bold">{order.store_name}</p>
          {order.store_address ? (
            <p className="text-[12px] text-[#6E6E73] mt-0.5">{order.store_address}</p>
          ) : null}
        </section>
      ) : null}

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px] mb-3">Status</h2>
        {order.status.toLowerCase() === "failed" || order.status.toLowerCase() === "cancelled" ? (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 p-3">
            <XCircle size={20} color="#B91C1C" />
            <div>
              <p className="font-bold text-sm text-red-800">
                {order.status === "failed" ? "Payment failed" : "Cancelled"}
              </p>
              <p className="text-[12px] text-red-700 mt-0.5">
                {order.status === "failed"
                  ? "Place the order again to retry."
                  : "This order was cancelled."}
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {STEPS.map((s, i) => {
              const Icon = s.Icon;
              const done = i <= stepIdx;
              const current = i === stepIdx;
              return (
                <li
                  key={s.key}
                  className="flex items-center gap-3 rounded-2xl border px-3 py-2.5"
                  style={{
                    borderColor: done ? "#160800" : "#EBE5DE",
                    backgroundColor: current ? "#F7F4F0" : "transparent",
                    opacity: done ? 1 : 0.55,
                  }}
                >
                  <Icon size={18} color={done ? "#160800" : "#8E8E93"} />
                  <span className="text-sm font-bold flex-1">{s.label}</span>
                  {current ? (
                    <span className="text-[10px] uppercase tracking-widest text-[#A2492C] font-bold">
                      Now
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {order.status.toLowerCase() === "pending" ? (
        <section className="px-4 pt-4">
          <button
            type="button"
            disabled={cancelling}
            onClick={cancel}
            className="w-full flex items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 text-red-700 py-3 font-bold active:opacity-80"
          >
            <X size={16} />
            {cancelling ? "Cancelling…" : "Cancel order"}
          </button>
        </section>
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
                <span className="text-[#A2492C]">Tier perk</span>
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
            {order.loyalty_points_earned && order.loyalty_points_earned > 0 ? (
              <p
                className="mt-1 text-right"
                style={{ color: "#A2492C", fontSize: 12, fontWeight: 700 }}
              >
                +{order.loyalty_points_earned} beans earned
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
