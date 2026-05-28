"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ChevronRight } from "lucide-react";

/**
 * Active order banner on home. Polls /api/loyalty/orders for the
 * customer's most recent in-progress order; renders a colored panel
 * (red/yellow/green) showing the status + order number when one is
 * found. Mirrors apps/pickup-native/app/index.tsx:653-699.
 */
type Order = {
  id: string;
  order_number: string;
  status: string;
};

type Persisted = { state?: { phone?: string | null; sessionToken?: string | null } };

const ACTIVE = new Set(["pending", "paid", "preparing", "ready"]);

function statusLabel(status: string): string {
  const s = (status ?? "").toLowerCase();
  if (s === "pending") return "Awaiting payment";
  if (s === "paid") return "Payment confirmed";
  if (s === "preparing") return "Brewing";
  if (s === "ready") return "Ready for pickup";
  return s;
}

export function ActiveOrderTracker() {
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let phone: string | null = null;
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        phone = parsed.state?.phone ?? null;
        token = parsed.state?.sessionToken ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!phone) return;

    const fetchActive = async () => {
      try {
        const res = await fetch(
          `/api/loyalty/orders?phone=${encodeURIComponent(phone!)}&limit=5`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        const data = await res.json();
        const list = (data?.orders ?? data ?? []) as Order[];
        const inflight = list.find((o) => ACTIVE.has((o.status ?? "").toLowerCase()));
        setOrder(inflight ?? null);
      } catch {
        /* ignore */
      }
    };
    fetchActive();
    // Refresh every 15s so the customer sees the status flip from
    // Brewing → Ready without reloading the page.
    const id = window.setInterval(fetchActive, 15000);
    return () => window.clearInterval(id);
  }, []);

  if (!order) return null;

  const s = (order.status ?? "").toLowerCase();
  const tone =
    s === "ready" || s === "completed"
      ? {
          fg: "#2E7D32",
          tint: "rgba(46,125,50,0.10)",
          border: "rgba(46,125,50,0.25)",
          chip: "rgba(46,125,50,0.15)",
        }
      : s === "pending" || s === "failed" || s === "cancelled"
      ? {
          fg: "#B91C1C",
          tint: "rgba(185,28,28,0.10)",
          border: "rgba(185,28,28,0.25)",
          chip: "rgba(185,28,28,0.15)",
        }
      : {
          fg: "#B45309",
          tint: "rgba(180,83,9,0.10)",
          border: "rgba(180,83,9,0.25)",
          chip: "rgba(180,83,9,0.15)",
        };

  return (
    <Link
      href={`/order/${order.id}`}
      className="block mx-4 mt-4 active:opacity-85"
      style={{
        backgroundColor: tone.tint,
        border: `1px solid ${tone.border}`,
        borderRadius: 16,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tone.chip }}
        >
          <Clock size={18} color={tone.fg} strokeWidth={2} />
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block uppercase truncate"
            style={{
              color: tone.fg,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
            }}
          >
            {statusLabel(order.status)}
          </span>
          <span
            className="block font-peachi font-bold truncate"
            style={{ color: "#1A0200", fontSize: 14, marginTop: 2 }}
          >
            Order #{order.order_number}
          </span>
        </span>
        <ChevronRight size={16} color={tone.fg} />
      </div>
    </Link>
  );
}
