"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";

type Order = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  order_items?: Array<{ product_name: string; quantity: number }>;
};

type Persisted = { state?: { phone?: string | null } };

function readPhone(): string | null {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    return parsed.state?.phone ?? null;
  } catch {
    return null;
  }
}

type Tab = "active" | "past";
const ACTIVE_STATUSES = new Set(["pending", "paid", "preparing", "ready"]);

export function OrdersView() {
  const [phone, setPhone] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");

  useEffect(() => {
    const p = readPhone();
    setPhone(p);
    if (!p) {
      setOrders([]);
      return;
    }
    fetch(`/api/loyalty/orders?phone=${encodeURIComponent(p)}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setOrders((data?.orders ?? data ?? []) as Order[]);
      })
      .catch((err) => setError(String(err)));
  }, []);

  const filtered = orders
    ? orders.filter((o) =>
        tab === "active"
          ? ACTIVE_STATUSES.has(o.status.toLowerCase())
          : !ACTIVE_STATUSES.has(o.status.toLowerCase()),
      )
    : null;

  // Default-flip: if there's no active order but there's history,
  // land the customer on Past so they don't see an empty list.
  useEffect(() => {
    if (!orders || orders.length === 0) return;
    const hasActive = orders.some((o) => ACTIVE_STATUSES.has(o.status.toLowerCase()));
    if (!hasActive && tab === "active") setTab("past");
  }, [orders, tab]);

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <h1
          className="text-[22px]"
          style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
        >
          Orders
        </h1>
      </header>

      {phone ? (
        <div className="flex border-b border-[#EBE5DE] px-4">
          <TabButton on={tab === "active"} onClick={() => setTab("active")} label="Active" />
          <TabButton on={tab === "past"} onClick={() => setTab("past")} label="Past" />
        </div>
      ) : null}

      {!phone ? (
        <EmptyCTA
          icon={<ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />}
          title="Sign in to see your orders"
          body="Your past orders will live here once you sign in."
          actionHref="/account"
          actionLabel="Sign in"
        />
      ) : orders === null ? (
        <div className="p-8 text-center text-[#8E8E93] text-sm">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyCTA
          icon={<ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />}
          title="No orders yet"
          body="Once you place your first order, it'll show up here."
          actionHref="/menu"
          actionLabel="Open the menu"
        />
      ) : (filtered ?? []).length === 0 ? (
        <EmptyCTA
          icon={<ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />}
          title={tab === "active" ? "No active orders" : "No past orders"}
          body={
            tab === "active"
              ? "Your in-progress orders will appear here while they're prepared."
              : "Completed and cancelled orders live here."
          }
          actionHref="/menu"
          actionLabel="Open the menu"
        />
      ) : (
        <ul className="px-4 py-4 flex flex-col gap-3">
          {(filtered ?? []).map((o) => (
            <li key={o.id}>
              <Link
                href={`/order/${o.id}`}
                className="flex items-center gap-3 bg-white rounded-2xl border border-[#EBE5DE] p-3 active:opacity-80"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">#{o.order_number}</p>
                  <p className="text-[11px] text-[#6E6E73] mt-0.5">
                    {new Date(o.created_at).toLocaleDateString("en-MY", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {o.status}
                  </p>
                  {o.order_items && o.order_items.length > 0 ? (
                    <p className="text-[11px] text-[#6E6E73] mt-0.5 line-clamp-1">
                      {o.order_items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
                    </p>
                  ) : null}
                </div>
                <span className="text-sm text-[#A2492C] font-bold">
                  RM{((o.total ?? 0) / 100).toFixed(2)}
                </span>
                <ChevronRight size={14} color="#8E8E93" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="px-4 pb-4 text-[11px] text-red-600">Couldn't load orders: {error}</p>
      ) : null}
    </>
  );
}

function EmptyCTA({
  icon,
  title,
  body,
  actionHref,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16">
      {icon}
      <p
        className="mt-4 text-base"
        style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
      >
        {title}
      </p>
      <p className="text-sm text-[#6E6E73] mt-1 text-center">{body}</p>
      <Link
        href={actionHref}
        className="mt-6 rounded-full bg-[#160800] text-white px-5 py-3 font-bold active:opacity-80"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function TabButton({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 py-3 active:opacity-60"
      aria-current={on ? "true" : undefined}
      style={{
        color: on ? "#160800" : "#8E8E93",
        fontWeight: on ? 700 : 600,
        borderBottom: on ? "2px solid #160800" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}
