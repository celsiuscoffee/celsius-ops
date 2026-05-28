"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, ChevronRight, CheckCircle2, XCircle, Coffee, Clock, MapPin, RefreshCw } from "lucide-react";

type OrderItem = {
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price?: number; // sen
  item_total?: number; // sen
  modifiers?: {
    selections?: Array<{ groupId?: string; groupName?: string; optionId?: string; label?: string; priceDelta?: number }>;
    specialInstructions?: string;
  } | null;
};

type Order = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  order_items?: OrderItem[];
  store_name?: string | null;
};

// Rebuild cart lines from a past order's items and drop them into the
// persisted cart, then send the customer to the cart. order_items carry
// product_id, unit_price + item_total (sen) and the modifiers jsonb, so
// the line reconstructs faithfully. Mirrors native's "Order again".
function reorder(order: Order): boolean {
  const items = order.order_items ?? [];
  if (items.length === 0) return false;
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    const state = parsed.state ?? {};
    state.cart = items.map((it, i) => ({
      cartId: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      productId: it.product_id ?? "",
      name: it.product_name,
      basePrice: (it.unit_price ?? 0) / 100,
      quantity: it.quantity,
      totalPrice: (it.item_total ?? 0) / 100,
      modifiers: (it.modifiers?.selections ?? []).map((s) => ({
        groupId: s.groupId ?? "",
        groupName: s.groupName ?? "",
        optionId: s.optionId ?? "",
        label: s.label ?? "",
        priceDelta: s.priceDelta ?? 0,
      })),
      specialInstructions: it.modifiers?.specialInstructions,
    }));
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
    return true;
  } catch {
    return false;
  }
}

type Persisted = { state?: { phone?: string | null; sessionToken?: string | null } };

function readAuth(): { phone: string | null; token: string | null } {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return { phone: null, token: null };
    const parsed = JSON.parse(raw) as Persisted;
    return {
      phone: parsed.state?.phone ?? null,
      token: parsed.state?.sessionToken ?? null,
    };
  } catch {
    return { phone: null, token: null };
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
    const { phone: p, token } = readAuth();
    setPhone(p);
    if (!p) {
      setOrders([]);
      return;
    }
    // Send the session token as a Bearer header so the request still
    // resolves when STRICT_CUSTOMER_AUTH is on (the order API matches
    // the signed phone against the queried phone).
    fetch(`/api/loyalty/orders?phone=${encodeURIComponent(p)}&limit=20`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
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
          style={{ fontFamily: "var(--font-display)", letterSpacing: -0.3, fontWeight: 700 }}
        >
          Orders
        </h1>
      </header>

      {phone ? (
        <div className="flex border-b border-[#EBE5DE] px-4">
          <TabButton on={tab === "active"} onClick={() => setTab("active")} label="In progress" />
          <TabButton on={tab === "past"} onClick={() => setTab("past")} label="Past orders" />
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
            <OrderRow key={o.id} order={o} />
          ))}
        </ul>
      )}

      {error ? (
        <p className="px-4 pb-4 text-[11px] text-red-600">Couldn't load orders: {error}</p>
      ) : null}
    </>
  );
}

function OrderRow({ order }: { order: Order }) {
  const router = useRouter();
  const status = order.status.toLowerCase();
  const StatusIcon =
    status === "completed" || status === "ready"
      ? CheckCircle2
      : status === "cancelled" || status === "failed"
      ? XCircle
      : status === "preparing" || status === "paid"
      ? Coffee
      : Clock;
  const statusColor =
    status === "completed" || status === "ready"
      ? "#16A34A"
      : status === "cancelled" || status === "failed"
      ? "#A2492C"
      : "#8E8E93";

  const date = new Date(order.created_at);
  const dateLabel = date.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const items = order.order_items ?? [];
  const itemSummary =
    items
      .slice(0, 2)
      .map((i) => `${i.quantity}× ${i.product_name}`)
      .join(", ") + (items.length > 2 ? ` · +${items.length - 2} more` : "");

  const totalRm = (order.total ?? 0) / 100;

  return (
    <li
      className="bg-white"
      style={{
        border: "1px solid rgba(26,2,0,0.10)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
      }}
    >
      <Link href={`/order/${order.id}`} className="block active:opacity-70">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon size={16} color={statusColor} strokeWidth={2} />
            <span
              className="uppercase"
              style={{ color: statusColor, fontSize: 12, fontWeight: 700, letterSpacing: 0.8 }}
            >
              {status}
            </span>
          </div>
          <span style={{ color: "#6B6B6B", fontSize: 11, fontWeight: 500 }}>
            #{order.order_number}
          </span>
        </div>

        <p
          className="font-peachi font-bold truncate"
          style={{ color: "#1A0200", fontSize: 15, marginTop: 8 }}
        >
          {itemSummary || "Order"}
        </p>
        {order.store_name ? (
          <div className="flex items-center" style={{ marginTop: 6, gap: 4 }}>
            <MapPin size={11} color="#8E8E93" strokeWidth={2} />
            <span className="truncate" style={{ color: "#6B6B6B", fontSize: 12, fontWeight: 500 }}>
              {order.store_name}
            </span>
          </div>
        ) : null}
        <p style={{ color: "#6B6B6B", fontSize: 12, marginTop: 2 }}>
          {dateLabel} · {timeLabel} · RM{totalRm.toFixed(2)}
        </p>
      </Link>

      <div
        className="mt-3 pt-3 flex"
        style={{ borderTop: "1px solid rgba(26,2,0,0.10)", gap: 8 }}
      >
        <Link
          href={`/order/${order.id}`}
          className="flex-1 flex items-center justify-center gap-1 rounded-full bg-white active:opacity-70"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 13 }}>
            View
          </span>
          <ChevronRight size={14} color="#160800" />
        </Link>
        <button
          type="button"
          onClick={() => {
            if (reorder(order)) router.push("/cart");
            else router.push("/menu");
          }}
          className="flex-1 flex items-center justify-center gap-1 rounded-full active:opacity-80"
          style={{
            backgroundColor: "#1A0200",
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <RefreshCw size={13} color="#FFFFFF" strokeWidth={2.5} />
          <span className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 13 }}>
            Order again
          </span>
        </button>
      </div>
    </li>
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
        style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
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
        color: on ? "#A2492C" : "#8E8E93",
        fontWeight: on ? 700 : 600,
        borderBottom: on ? "2px solid #A2492C" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}
