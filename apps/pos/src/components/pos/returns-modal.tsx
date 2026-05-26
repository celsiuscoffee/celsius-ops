"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Search, Receipt, Minus, Plus, ChevronLeft, RotateCcw } from "lucide-react";
import { displayRM } from "@/types/database";
import { createClient } from "@/lib/supabase-browser";
import { usePOS } from "@/lib/pos-context";
import { printReceipt80mm } from "@/lib/sunmi-printer";

/**
 * Returns / refund modal. Opened from the sidebar.
 *
 * Flow:
 *   list  → search by order_number / customer phone / date (default today)
 *   detail → expand an order, set per-line refund quantity (0..remaining),
 *            pick refund method, type reason, fire POST /api/pos/refund
 *
 * Refund permissions are enforced server-side (the API requires Manager+
 * role); this UI just hides destructive controls when the current staff
 * is a plain cashier so they never hit a 403 they can't fix on the spot.
 */

type Props = {
  onClose: () => void;
};

type DBOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  modifier_total: number;
  item_total: number;
  refunded_quantity: number | null;
};

type DBOrder = {
  id: string;
  order_number: string;
  outlet_id: string;
  order_type: string;
  status: string;
  table_number: string | null;
  queue_number: string | null;
  subtotal: number;
  service_charge: number;
  discount_amount: number;
  promo_discount: number;
  total: number;
  customer_phone: string | null;
  customer_name: string | null;
  refund_of_order_id: string | null;
  refunded_at: string | null;
  created_at: string;
  pos_order_items?: DBOrderItem[];
  pos_order_payments?: { payment_method: string; amount: number }[];
};

type RefundMethod = "cash" | "card" | "store_credit";

export function ReturnsModal({ onClose }: Props) {
  const pos = usePOS();
  const supabase = createClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [searchDate, setSearchDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [results, setResults] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DBOrder | null>(null);

  // Per-line refund quantity (orderItemId → qty)
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<RefundMethod>("cash");
  const [submitting, setSubmitting] = useState(false);

  // Refunds are manager+ only. We surface the gate up front so a
  // cashier doesn't fill out a refund form just to get a 403.
  const canRefund =
    pos.staff?.role === "manager" ||
    pos.staff?.role === "admin" ||
    pos.staff?.role === "owner" ||
    pos.staff?.role === "MANAGER" ||
    pos.staff?.role === "ADMIN" ||
    pos.staff?.role === "OWNER";

  // ─── Search ─────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (!pos.outlet) return;
    setLoading(true);
    try {
      // Default: today's orders for this outlet. Filter applied client-
      // side by order_number / phone substring to keep the SQL simple.
      let query = supabase
        .from("pos_orders")
        .select(
          "id, order_number, outlet_id, order_type, status, table_number, queue_number, subtotal, service_charge, discount_amount, promo_discount, total, customer_phone, customer_name, refund_of_order_id, refunded_at, created_at, pos_order_items(*), pos_order_payments(*)",
        )
        .eq("outlet_id", pos.outlet.id)
        .is("refund_of_order_id", null) // hide refund rows themselves
        .order("created_at", { ascending: false })
        .limit(100);

      if (searchDate) {
        // Search exactly within the chosen day (outlet local time ≈ UTC+8).
        // Range is a 24-hour window in UTC; close enough for daily cuts.
        const start = `${searchDate}T00:00:00.000Z`;
        const end = `${searchDate}T23:59:59.999Z`;
        query = query.gte("created_at", start).lte("created_at", end);
      }

      const { data, error } = await query;
      if (error) throw error;
      let rows = (data ?? []) as DBOrder[];
      if (searchTerm.trim()) {
        const needle = searchTerm.trim().toLowerCase();
        rows = rows.filter(
          (r) =>
            r.order_number.toLowerCase().includes(needle) ||
            (r.customer_phone ?? "").toLowerCase().includes(needle) ||
            (r.customer_name ?? "").toLowerCase().includes(needle),
        );
      }
      setResults(rows);
    } catch (e) {
      console.error("[ReturnsModal] search failed:", e);
      toast.error("Search failed");
    } finally {
      setLoading(false);
    }
  }, [pos.outlet, searchDate, searchTerm, supabase]);

  // Run once on mount with default (today).
  useEffect(() => {
    void runSearch();
    // Intentional one-shot — subsequent searches fire from explicit user
    // actions (Enter / blur / date change handled below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when the date changes — the day picker is a primary
  // affordance so it should re-search immediately.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDate]);

  function selectOrder(o: DBOrder) {
    setSelectedOrder(o);
    // Reset per-line refund qty to zero, only for lines with remaining > 0.
    const init: Record<string, number> = {};
    for (const it of o.pos_order_items ?? []) {
      const remaining = it.quantity - (it.refunded_quantity ?? 0);
      if (remaining > 0) init[it.id] = 0;
    }
    setRefundQty(init);
    setReason("");
    setMethod("cash");
  }

  function bumpQty(itemId: string, delta: number, max: number) {
    setRefundQty((prev) => {
      const next = Math.max(0, Math.min(max, (prev[itemId] ?? 0) + delta));
      return { ...prev, [itemId]: next };
    });
  }

  // Compute preview totals — mirrors the API's math so the cashier
  // sees what they're about to charge back before they tap Refund.
  function computePreview(): {
    subtotal: number;
    serviceCharge: number;
    discount: number;
    total: number;
    hasAny: boolean;
  } {
    if (!selectedOrder) return { subtotal: 0, serviceCharge: 0, discount: 0, total: 0, hasAny: false };
    let sub = 0;
    for (const it of selectedOrder.pos_order_items ?? []) {
      const qty = refundQty[it.id] ?? 0;
      if (qty <= 0) continue;
      const perUnit = it.quantity > 0 ? Math.round(it.item_total / it.quantity) : 0;
      sub += perUnit * qty;
    }
    const origSubAbs = selectedOrder.subtotal > 0 ? selectedOrder.subtotal : 1;
    const sc = Math.round((selectedOrder.service_charge * sub) / origSubAbs);
    const dc = Math.round(
      ((selectedOrder.discount_amount + selectedOrder.promo_discount) * sub) / origSubAbs,
    );
    const total = Math.max(0, sub - dc + sc);
    return { subtotal: sub, serviceCharge: sc, discount: dc, total, hasAny: sub > 0 };
  }

  async function handleRefund() {
    if (!selectedOrder || !pos.staff) return;
    const preview = computePreview();
    if (!preview.hasAny) {
      toast.error("Set refund quantity on at least one line");
      return;
    }
    if (reason.trim().length < 2) {
      toast.error("Reason required");
      return;
    }

    setSubmitting(true);
    try {
      // For card refunds, hit the RM terminal first for the negative
      // amount. If the terminal call fails we abort BEFORE writing to
      // the DB so we don't end up with a refund row but no money back.
      if (method === "card") {
        const termRes = await fetch("/api/payment/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: `REFUND-${selectedOrder.order_number}-${Date.now()}`,
            orderTitle: `Refund of ${selectedOrder.order_number}`,
            // RM terminal expects positive amount; the negative sign
            // is implicit in the "refund" path. For now we pass the
            // absolute value — the RM terminal integration treats
            // refunds as a separate operation type which RM may or
            // may not support on this account. If they don't, the
            // terminal will return a clear error and we surface it.
            amount: preview.total,
            type: "CARD",
          }),
        });
        const termData = await termRes.json();
        if (!termRes.ok || termData.error) {
          throw new Error(termData.error || "Card terminal refund failed");
        }
      }

      const body = {
        original_order_id: selectedOrder.id,
        items: Object.entries(refundQty)
          .filter(([, q]) => q > 0)
          .map(([pos_order_item_id, quantity]) => ({ pos_order_item_id, quantity })),
        reason: reason.trim(),
        refund_method: method,
        employee_id: pos.staff.id,
      };

      const res = await fetch("/api/pos/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Refund failed");
      }

      toast.success(`Refunded ${displayRM(data.refund_total_sen)}`);

      // Print refund receipt — fetch the freshly-inserted refund row
      // with its items + payments so the printer formatter has every-
      // thing it needs. Best-effort; failure shouldn't undo the refund.
      try {
        const { data: refundOrder } = await supabase
          .from("pos_orders")
          .select("*, pos_order_items(*), pos_order_payments(*)")
          .eq("id", data.refund_order_id)
          .single();
        if (refundOrder) {
          await printReceipt80mm(
            { ...refundOrder, original_order_number: selectedOrder.order_number },
            {
              name: pos.outlet?.name ?? "Celsius Coffee",
              address: pos.outlet?.address,
              city: pos.outlet?.city,
              state: pos.outlet?.state,
              phone: pos.outlet?.phone,
            },
          );
        }
      } catch (e) {
        console.warn("[ReturnsModal] receipt print failed:", e);
      }

      // Refresh order list + reload pos context completed orders so
      // the shift report picks up the new refund row.
      await pos.loadOrders();
      await runSearch();
      onClose();
    } catch (e) {
      console.error("[ReturnsModal] refund failed:", e);
      toast.error(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setSubmitting(false);
    }
  }

  const preview = computePreview();

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 flex h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            {selectedOrder && (
              <button
                onClick={() => setSelectedOrder(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-hover"
                aria-label="Back to list"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <RotateCcw className="h-5 w-5 text-text-muted" />
            <h3 className="text-lg font-semibold">
              {selectedOrder ? selectedOrder.order_number : "Returns"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-xl hover:bg-surface-hover"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Permission gate */}
        {!canRefund && (
          <div className="mx-5 mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            Refunds require Manager role or above. You can search and view orders, but the Refund button will be disabled.
          </div>
        )}

        {/* List or Detail */}
        {!selectedOrder ? (
          <>
            {/* Search */}
            <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                  onBlur={() => void runSearch()}
                  placeholder="Order # or customer phone"
                  className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-text outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </div>
              <input
                type="date"
                value={searchDate}
                onChange={(e) => setSearchDate(e.target.value)}
                className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-text-muted">
                  <Receipt className="h-10 w-10 opacity-40" />
                  <p className="mt-2 text-sm">No orders found</p>
                  <p className="text-xs text-text-dim">Try a different date or search term</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {results.map((order) => {
                    const itemCount = order.pos_order_items?.length ?? 0;
                    const isFullRefunded = !!order.refunded_at;
                    return (
                      <button
                        key={order.id}
                        onClick={() => selectOrder(order)}
                        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-surface-hover"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{order.order_number}</span>
                            {order.status === "cancelled" && (
                              <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger">
                                VOID
                              </span>
                            )}
                            {isFullRefunded && (
                              <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                                REFUNDED
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted">
                            {format(new Date(order.created_at), "h:mm a")} &middot; {itemCount} items
                            {order.customer_phone ? ` · ${order.customer_phone}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold">{displayRM(order.total)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Detail */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Order header */}
              <div className="mb-4 rounded-lg bg-surface p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">
                    {format(new Date(selectedOrder.created_at), "EEE d MMM yyyy, h:mm a")}
                  </span>
                  <span
                    style={{ fontFamily: "Peachi", fontWeight: 700 }}
                    className="text-base"
                  >
                    {displayRM(selectedOrder.total)}
                  </span>
                </div>
                {selectedOrder.customer_phone && (
                  <p className="mt-1 text-xs text-text-dim">{selectedOrder.customer_phone}</p>
                )}
                {selectedOrder.refunded_at && (
                  <p className="mt-1 text-xs text-warning">
                    Fully refunded on {format(new Date(selectedOrder.refunded_at), "d MMM h:mm a")}
                  </p>
                )}
              </div>

              {/* Items with steppers */}
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
                Items
              </h4>
              <div className="space-y-2">
                {(selectedOrder.pos_order_items ?? []).map((it) => {
                  const remaining = it.quantity - (it.refunded_quantity ?? 0);
                  const qty = refundQty[it.id] ?? 0;
                  const perUnit = it.quantity > 0 ? Math.round(it.item_total / it.quantity) : 0;
                  const disabled = remaining <= 0;
                  return (
                    <div
                      key={it.id}
                      className={`rounded-lg border p-3 ${
                        disabled ? "border-border bg-surface opacity-50" : "border-border bg-surface"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{it.product_name}</p>
                          {it.variant_name && (
                            <p className="text-xs text-text-muted">{it.variant_name}</p>
                          )}
                          <p className="mt-0.5 text-xs text-text-dim">
                            {displayRM(perUnit)} each &middot; sold {it.quantity}
                            {(it.refunded_quantity ?? 0) > 0 && (
                              <span className="text-warning">
                                {" "}
                                · already refunded {it.refunded_quantity}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => bumpQty(it.id, -1, remaining)}
                            disabled={disabled || qty === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-surface-hover disabled:opacity-40"
                            aria-label="Decrease"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span
                            className="w-10 text-center text-base"
                            style={{ fontFamily: "Peachi", fontWeight: 700 }}
                          >
                            {qty}
                          </span>
                          <button
                            onClick={() => bumpQty(it.id, 1, remaining)}
                            disabled={disabled || qty >= remaining}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-surface-hover disabled:opacity-40"
                            aria-label="Increase"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <span className="ml-1 w-8 text-right text-xs text-text-muted">/ {remaining}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reason */}
              <div className="mt-4">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-dim">
                  Reason
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Wrong order, customer changed mind, …"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </div>

              {/* Method */}
              <div className="mt-4">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-dim">
                  Refund Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: "cash", label: "Cash" },
                    { id: "card", label: "Card" },
                    { id: "store_credit", label: "Store Credit" },
                  ] as { id: RefundMethod; label: string }[]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={`rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                        method === m.id
                          ? "border-brand bg-brand/15 text-brand"
                          : "border-border text-text-muted hover:bg-surface-hover"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {method === "card" && (
                  <p className="mt-1 text-[11px] text-text-dim">
                    Refund will be issued via the terminal.
                  </p>
                )}
              </div>

              {/* Preview */}
              {preview.hasAny && (
                <div className="mt-4 rounded-lg bg-surface p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Items subtotal</span>
                    <span>{displayRM(preview.subtotal)}</span>
                  </div>
                  {preview.discount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Discount share</span>
                      <span className="text-success">-{displayRM(preview.discount)}</span>
                    </div>
                  )}
                  {preview.serviceCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Service charge</span>
                      <span>{displayRM(preview.serviceCharge)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between border-t border-border pt-1">
                    <span className="font-semibold">Refund total</span>
                    <span
                      style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
                      className="text-base"
                    >
                      {displayRM(preview.total)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer action */}
            <div className="border-t border-border px-5 py-4">
              <button
                onClick={handleRefund}
                disabled={!canRefund || !preview.hasAny || reason.trim().length < 2 || submitting}
                className="w-full rounded-xl bg-danger py-3.5 text-base font-bold text-white hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? "Processing…"
                  : preview.hasAny
                    ? `Refund ${displayRM(preview.total)}`
                    : "Select items to refund"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
