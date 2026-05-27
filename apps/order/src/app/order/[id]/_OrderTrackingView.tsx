"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, Coffee, Package, XCircle } from "lucide-react";

type OrderItem = {
  product_name: string;
  quantity: number;
  item_total: number;
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
};

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

      <section className="px-4 pt-5">
        <h2 className="font-peachi font-bold text-[16px] mb-2">Your order</h2>
        <ul className="flex flex-col gap-1">
          {(order.order_items ?? []).map((it, i) => (
            <li key={i} className="flex items-baseline gap-3 text-sm">
              <span className="text-[#160800] font-bold w-6">{it.quantity}×</span>
              <span className="flex-1 truncate">{it.product_name}</span>
              <span className="text-[#A2492C] font-bold">
                RM{((it.item_total ?? 0) / 100).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-[#EBE5DE] pt-3">
          <span className="text-sm text-[#6E6E73]">Total</span>
          <span className="font-peachi font-bold text-xl">
            RM{((order.total ?? 0) / 100).toFixed(2)}
          </span>
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
