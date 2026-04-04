"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, XCircle, Loader2, ChevronRight } from "lucide-react";
import { getSupabaseClient } from "@/lib/pickup/supabase";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import type { OrderRow, OrderItemRow } from "@/lib/pickup/types";

const STATUS_COLOUR: Record<string, string> = {
  pending:   "bg-gray-100 text-gray-600",
  paid:      "bg-blue-100 text-blue-600",
  preparing: "bg-amber-100 text-amber-700",
  ready:     "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-500",
  failed:    "bg-red-100 text-red-600",
};

interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
}

const NEXT_STATUS: Record<string, { label: string; status: string; colour: string } | undefined> = {
  pending:   { label: "Start Preparing",  status: "preparing", colour: "bg-amber-500 hover:bg-amber-600" },
  paid:      { label: "Start Preparing",  status: "preparing", colour: "bg-amber-500 hover:bg-amber-600" },
  preparing: { label: "Mark as Ready",    status: "ready",     colour: "bg-green-600 hover:bg-green-700" },
  ready:     { label: "Mark as Completed", status: "completed", colour: "bg-gray-700  hover:bg-gray-800"  },
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order,    setOrder]    = useState<OrderWithItems | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    async function load() {
      const { data: orderData } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .single();

      if (!orderData) { setLoading(false); return; }

      const { data: items } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id)
        .order("created_at");

      setOrder({ ...(orderData as OrderRow), order_items: (items ?? []) as OrderItemRow[] });
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleAdvanceStatus(nextStatus: string) {
    if (!order || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await adminFetch(`/api/pickup/orders/${id}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Update failed");
      }
      setOrder((prev) => prev ? { ...prev, status: nextStatus as OrderRow["status"] } : null);
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setAdvancing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Order not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">#{order.order_number}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date(order.created_at).toLocaleString("en-MY", {
              weekday: "short", day: "numeric", month: "short",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </div>
        <span className={`ml-auto text-xs font-semibold px-3 py-1 rounded-full ${STATUS_COLOUR[order.status]}`}>
          {order.status}
        </span>
      </div>

      {order.status === "failed" && (
        <div className="bg-red-50 rounded-xl px-4 py-3 flex items-center gap-2 text-red-600 text-sm">
          <XCircle className="h-4 w-4 shrink-0" />
          Payment failed — order was not charged
        </div>
      )}

      {/* Status advance button */}
      {NEXT_STATUS[order.status] && (
        <div className="space-y-2">
          <button
            onClick={() => handleAdvanceStatus(NEXT_STATUS[order.status]!.status)}
            disabled={advancing}
            className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 ${NEXT_STATUS[order.status]!.colour}`}
          >
            {advancing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ChevronRight className="h-4 w-4" />
            }
            {NEXT_STATUS[order.status]!.label}
          </button>
          {advanceError && (
            <p className="text-xs text-red-500 text-center">{advanceError}</p>
          )}
        </div>
      )}

      {/* Outlet + pickup */}
      <div className="bg-white rounded-2xl p-4 space-y-2">
        <h2 className="font-bold text-sm mb-3">Pickup Details</h2>
        <Row label="Outlet"  value={order.store_id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
        <Row label="Payment" value={order.payment_method.replace(/_/g, " ").toUpperCase()} />
        {order.payment_provider_ref && (
          <Row label="Ref" value={order.payment_provider_ref} mono />
        )}
      </div>

      {/* Customer */}
      <div className="bg-white rounded-2xl p-4 space-y-2">
        <h2 className="font-bold text-sm mb-3">Customer</h2>
        <Row label="Name"  value={order.customer_name  ?? "—"} />
        <Row label="Phone" value={order.customer_phone ?? "—"} />
        {order.notes && <Row label="Notes" value={order.notes} />}
      </div>

      {/* Items */}
      <div className="bg-white rounded-2xl p-4">
        <h2 className="font-bold text-sm mb-3">Order Items</h2>
        <div className="space-y-3">
          {order.order_items.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#160800] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {item.quantity}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{item.product_name}</p>
                {item.variant_name && (
                  <p className="text-xs text-muted-foreground">{item.variant_name}</p>
                )}
                {item.modifiers && (
                  <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                    {(item.modifiers.selections ?? []).map((s: { label: string; groupId: string }) => (
                      <p key={s.groupId + s.label}>{s.label}</p>
                    ))}
                    {item.modifiers.specialInstructions && (
                      <p className="italic">&quot;{item.modifiers.specialInstructions}&quot;</p>
                    )}
                  </div>
                )}
              </div>
              <span className="text-sm font-semibold">RM {(item.item_total / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="bg-white rounded-2xl p-4 space-y-2">
        <Row label="Subtotal" value={`RM ${(order.subtotal / 100).toFixed(2)}`} />
        {order.discount_amount > 0 && (
          <Row
            label={order.voucher_code ? `Voucher (${order.voucher_code})` : "Voucher Discount"}
            value={`- RM ${(order.discount_amount / 100).toFixed(2)}`}
            highlight="emerald"
          />
        )}
        {order.reward_discount_amount > 0 && (
          <Row
            label={order.reward_name ? `Reward: ${order.reward_name}` : "Reward Discount"}
            value={`- RM ${(order.reward_discount_amount / 100).toFixed(2)}`}
            highlight="purple"
          />
        )}
        <Row label="SST (6%)" value={`RM ${(order.sst_amount / 100).toFixed(2)}`} />
        <div className="border-t pt-2 mt-2">
          <div className="flex justify-between">
            <span className="font-bold text-sm">Total</span>
            <span className="font-bold text-sm">RM {(order.total / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: "emerald" | "purple" }) {
  const colour = highlight === "emerald" ? "text-emerald-600" : highlight === "purple" ? "text-purple-600" : "";
  return (
    <div className="flex justify-between gap-4">
      <span className={`text-sm ${highlight ? colour : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm font-medium text-right ${mono ? "font-mono" : ""} ${colour}`}>{value}</span>
    </div>
  );
}
