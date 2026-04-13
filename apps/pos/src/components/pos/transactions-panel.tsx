"use client";

import { useState } from "react";
import { usePOS } from "@/lib/pos-context";
import { displayRM } from "@/types/database";
import { format } from "date-fns";
import { printReceipt58mm } from "@/lib/sunmi-printer";

type Props = {
  onBack: () => void;
};

export function TransactionsPanel({ onBack }: Props) {
  const pos = usePOS();
  const { completedOrders, voidOrder, staff } = pos;
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  function handleVoid() {
    if (selectedOrder && voidReason) {
      voidOrder(selectedOrder.id, voidReason);
      setShowVoidDialog(false);
      setVoidReason("");
      setSelectedOrder(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Transaction History</h2>
          <p className="text-xs text-text-muted">{completedOrders.length} orders this shift</p>
        </div>
      </div>

      {selectedOrder ? (
        /* Order detail view */
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <button onClick={() => setSelectedOrder(null)} className="mb-3 text-xs text-brand hover:underline">
              &larr; Back to list
            </button>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{selectedOrder.order_number}</p>
                <p className="text-xs text-text-muted">
                  {format(selectedOrder.created_at, "h:mm a")} &middot; {selectedOrder.employeeName}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  selectedOrder.status === "completed"
                    ? "bg-success/20 text-success"
                    : selectedOrder.status === "cancelled"
                    ? "bg-danger/20 text-danger"
                    : "bg-warning/20 text-warning"
                }`}
              >
                {selectedOrder.status === "completed" ? "Completed" : selectedOrder.status === "cancelled" ? "Void" : "Refunded"}
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                selectedOrder.order_type === "dine_in" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
              }`}>
                {selectedOrder.order_type === "dine_in" ? `Dine-in Table ${selectedOrder.table_number}` : `Takeaway ${selectedOrder.queue_number}`}
              </span>
              <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-muted">
                {selectedOrder.payment_method}
              </span>
            </div>

            {/* Items */}
            <div className="mt-4 divide-y divide-border rounded-lg border border-border">
              {(selectedOrder.items ?? selectedOrder.pos_order_items ?? []).map((item: any, i: number) => (
                <div key={i} className="flex justify-between px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">
                      {item.quantity > 1 && <span className="text-brand">{item.quantity}x </span>}
                      {item.name}
                    </span>
                    {item.variant && <span className="ml-1 text-text-muted">({item.variant})</span>}
                    {item.modifiers.length > 0 && (
                      <p className="text-xs text-text-dim">{item.modifiers.join(", ")}</p>
                    )}
                  </div>
                  <span className="font-medium">{displayRM(item.total)}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Subtotal</span><span>{displayRM(selectedOrder.subtotal)}</span></div>
              {selectedOrder.service_charge > 0 && <div className="flex justify-between"><span className="text-text-muted">Service Charge</span><span>{displayRM(selectedOrder.service_charge)}</span></div>}
              {selectedOrder.discount > 0 && <div className="flex justify-between"><span className="text-text-muted">Discount</span><span className="text-success">-{displayRM(selectedOrder.discount)}</span></div>}
              {selectedOrder.tax > 0 && <div className="flex justify-between"><span className="text-text-muted">Tax</span><span>{displayRM(selectedOrder.tax)}</span></div>}
              <div className="flex justify-between pt-1 font-bold"><span>Total</span><span>{displayRM(selectedOrder.total)}</span></div>
            </div>

            {selectedOrder.cancellation_reason && (
              <div className="mt-3 rounded-lg bg-danger/10 p-3 text-xs text-danger">
                Void reason: {selectedOrder.cancellation_reason}
              </div>
            )}

            {/* Actions */}
            {selectedOrder.status === "completed" && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => printReceipt58mm(selectedOrder, {
                    name: pos.outlet?.name ?? "Celsius Coffee",
                    address: pos.outlet?.address,
                    city: pos.outlet?.city,
                    state: pos.outlet?.state,
                    phone: pos.outlet?.phone,
                  })}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium hover:bg-surface-hover"
                >
                  Print Receipt
                </button>
                <button
                  onClick={() => setShowVoidDialog(true)}
                  className="flex-1 rounded-lg bg-danger py-2 text-sm font-semibold text-white hover:bg-danger/80"
                >
                  Void Order
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Order list */
        <div className="flex-1 overflow-y-auto">
          {completedOrders.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-text-muted">
              <span className="text-3xl">📝</span>
              <p className="mt-2 text-sm">No transactions yet</p>
              <p className="text-xs text-text-dim">Completed orders will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {completedOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          order.order_type === "dine_in" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                        }`}
                      >
                        {order.order_type === "dine_in" ? `T${order.table_number}` : order.queue_number}
                      </span>
                      <span className="text-xs text-text-dim">{order.order_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{displayRM(order.total)}</span>
                      {order.status === "cancelled" && (
                        <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger">VOID</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                    <span>{(order.pos_order_items?.length ?? 0)} items</span>
                    <span>{format(order.created_at, "h:mm a")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Void dialog */}
      {showVoidDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-2xl bg-surface-raised p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-danger">Void Order</h3>
            <p className="mt-1 text-sm text-text-muted">
              This will cancel order {selectedOrder?.orderNumber}. This action cannot be undone.
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-text-muted">Reason *</label>
              <select
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-danger"
              >
                <option value="">Select reason</option>
                <option value="Customer cancelled">Customer cancelled</option>
                <option value="Wrong order">Wrong order</option>
                <option value="Payment issue">Payment issue</option>
                <option value="Duplicate order">Duplicate order</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setShowVoidDialog(false); setVoidReason(""); }}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-medium hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleVoid}
                disabled={!voidReason}
                className="flex-1 rounded-lg bg-danger py-2 text-sm font-semibold text-white hover:bg-danger/80 disabled:opacity-50"
              >
                Confirm Void
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
