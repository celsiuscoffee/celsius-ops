"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Loader2, CheckCircle2, QrCode, Store } from "lucide-react";

type PendingOrder = {
  id: string;
  order_number: string;
  store_id: string;
  status: string;
  payment_method: string;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
};

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  conezion: "Conezion",
  tamarind: "Tamarind Square",
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function MaybankQrOrdersPage() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Tick once a second so the relative "time ago" labels stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/maybank-qr-orders");
      const data = (await res.json()) as PendingOrder[] | { error: string };
      if (Array.isArray(data)) {
        setOrders(data);
        setError(null);
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setLoading(false);
  }, []);

  // Initial load + live updates via Supabase realtime so a payment that
  // lands while the page is open shows up without a refresh.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  useEffect(() => {
    load();
    // Anon client purely for the realtime channel — the page itself
    // proxies through the authed /api/pos/maybank-qr-orders route for
    // the actual data, so we don't expose row-level data here.
    if (!supabaseRef.current) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      supabaseRef.current = createClient(url, key);
    }
    const client = supabaseRef.current;
    const ch = client
      .channel("maybank-qr-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => load(),
      )
      .subscribe();
    return () => {
      client.removeChannel(ch);
    };
  }, [load]);

  async function release(id: string) {
    setReleasing(id);
    setError(null);
    try {
      const res = await fetch(`/api/pos/maybank-qr-orders/${id}/release`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Optimistic: remove from the local list — the realtime sub
      // will reconcile if anything else changed in the meantime.
      setOrders((cur) => cur.filter((o) => o.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release failed");
    }
    setReleasing(null);
  }

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <QrCode className="h-6 w-6 text-emerald-600" />
          Maybank QR — pending payments
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Customer orders waiting for staff to confirm the Maybank transfer and release to the kitchen.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-900">No pending Maybank QR payments</p>
          <p className="text-xs text-gray-500 mt-1">Anything new will appear here in real-time.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => {
            const outlet = STORE_NAMES[o.store_id] ?? o.store_id;
            // Use `now` to force re-render every second so the label
            // stays accurate; intentionally referenced even though
            // timeAgo derives from Date.now() itself.
            void now;
            return (
              <li
                key={o.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      #{o.order_number}
                    </span>
                    <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                      <Store className="h-3 w-3" />
                      {outlet}
                    </span>
                    <span className="text-xs text-gray-400">{timeAgo(o.created_at)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {o.customer_name || "Guest"} · {o.customer_phone || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-sm font-semibold text-gray-900">
                    RM {Number(o.total ?? 0).toFixed(2)}
                  </span>
                  <button
                    onClick={() => release(o.id)}
                    disabled={releasing === o.id}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {releasing === o.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {releasing === o.id ? "Releasing…" : "Mark paid & release"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
