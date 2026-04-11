"use client";

import { useState } from "react";
import { usePOS } from "@/lib/pos-context";
import { displayRM } from "@/types/database";
import { format } from "date-fns";

type Props = {
  mode: "open" | "close" | "report";
  onClose: () => void;
};

export function ShiftModal({ mode, onClose }: Props) {
  const { staff, outlet, register, currentShift, openShift, closeShift, completedOrders, openOrders, isShiftOpen } = usePOS();
  const [openingFloat, setOpeningFloat] = useState("");
  const [closingCash, setClosingCash] = useState("");

  const completed = completedOrders.filter((o) => o.status === "completed");
  const cancelled = completedOrders.filter((o) => o.status === "cancelled");
  const totalSales = completed.reduce((sum, o) => sum + o.total, 0);
  const totalRefunds = cancelled.reduce((sum, o) => sum + o.total, 0);

  // Payment method breakdown
  const byMethod: Record<string, { count: number; total: number }> = {};
  for (const order of completed) {
    const payments = (order as any).pos_order_payments ?? [];
    for (const p of payments) {
      const method = p.payment_method ?? "Unknown";
      if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
      byMethod[method].count++;
      byMethod[method].total += p.amount ?? 0;
    }
    if (payments.length === 0) {
      if (!byMethod["Unknown"]) byMethod["Unknown"] = { count: 0, total: 0 };
      byMethod["Unknown"].count++;
      byMethod["Unknown"].total += order.total;
    }
  }

  // Order type breakdown
  const dineInCount = completed.filter((o) => o.order_type === "dine_in").length;
  const takeawayCount = completed.filter((o) => o.order_type === "takeaway").length;

  function handleOpenShift() {
    openShift();
    onClose();
  }

  function handleCloseShift() {
    if (openOrders.length > 0) {
      alert(`Cannot close shift: ${openOrders.length} open order(s) need to be completed or cancelled first.`);
      return;
    }
    closeShift();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-2xl bg-surface-raised shadow-2xl">
        {/* Open Shift */}
        {mode === "open" && (
          <>
            <div className="border-b border-border px-6 py-5 text-center">
              <img src="/images/celsius-logo-sm.jpg" alt="Celsius" width={48} height={48} className="mx-auto rounded-xl" />
              <h3 className="mt-3 text-lg font-bold">Open Shift</h3>
              <p className="mt-1 text-sm text-text-muted">{outlet?.name ?? "—"} &middot; {register?.name ?? "—"}</p>
            </div>
            <div className="px-6 py-4">
              <div className="rounded-lg bg-surface p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {staff?.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{staff?.name}</p>
                    <p className="text-xs capitalize text-text-muted">{staff?.role}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-text-dim">
                  {format(new Date(), "EEEE, d MMMM yyyy")} &middot; {format(new Date(), "h:mm a")}
                </p>
              </div>
            </div>
            <div className="px-6 pb-2">
              <label className="mb-1 block text-xs font-medium text-text-muted">Opening Cash Float (RM)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg font-semibold text-center focus:border-brand focus:outline-none"
              />
            </div>
            <div className="border-t border-border px-6 py-4">
              <button
                onClick={handleOpenShift}
                className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Open Shift {openingFloat ? `(Float: RM ${parseFloat(openingFloat).toFixed(2)})` : ""}
              </button>
            </div>
          </>
        )}

        {/* Close Shift / Shift Report */}
        {(mode === "close" || mode === "report") && currentShift && (
          <>
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-lg font-bold">
                {mode === "close" ? "Close Shift" : "Shift Report"}
              </h3>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-hover">
                &times;
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {/* Summary */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-xs text-text-muted">Total Sales</p>
                  <p className="text-lg font-bold text-success">{displayRM(totalSales)}</p>
                </div>
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-xs text-text-muted">Orders</p>
                  <p className="text-lg font-bold">{completed.length}</p>
                </div>
                <div className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-xs text-text-muted">Cancelled</p>
                  <p className="text-lg font-bold text-danger">{cancelled.length}</p>
                </div>
              </div>

              {/* Shift info */}
              <div className="mb-4 rounded-lg bg-surface p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Opened by</span>
                  <span>{staff?.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Opened at</span>
                  <span>{format(new Date(currentShift.opened_at), "h:mm a")}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Duration</span>
                  <span>{Math.round((Date.now() - new Date(currentShift.opened_at).getTime()) / 60000)} min</span>
                </div>
              </div>

              {/* Payment method breakdown */}
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-semibold text-text-muted">Payment Methods</h4>
                {Object.keys(byMethod).length === 0 ? (
                  <p className="text-xs text-text-dim">No transactions yet</p>
                ) : (
                  <div className="space-y-1">
                    {Object.entries(byMethod).map(([method, data]) => (
                      <div key={method} className="flex justify-between rounded-lg bg-surface px-3 py-2 text-sm">
                        <span>{method}</span>
                        <span className="font-medium">{displayRM(data.total)} ({data.count})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order type breakdown */}
              <div className="mb-4">
                <h4 className="mb-2 text-xs font-semibold text-text-muted">Order Types</h4>
                <div className="flex gap-3">
                  <div className="flex-1 rounded-lg bg-surface p-3 text-center">
                    <p className="text-xs text-text-muted">Dine-in</p>
                    <p className="text-lg font-bold">{dineInCount}</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-surface p-3 text-center">
                    <p className="text-xs text-text-muted">Takeaway</p>
                    <p className="text-lg font-bold">{takeawayCount}</p>
                  </div>
                </div>
              </div>

              {/* Refunds */}
              {totalRefunds > 0 && (
                <div className="mb-4 rounded-lg bg-danger/10 p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-danger">Void / Refunds</span>
                    <span className="font-medium text-danger">-{displayRM(totalRefunds)}</span>
                  </div>
                </div>
              )}

              {/* Open orders warning */}
              {openOrders.length > 0 && mode === "close" && (
                <div className="mb-4 rounded-lg bg-warning/10 p-3">
                  <p className="text-xs font-medium text-warning">
                    {openOrders.length} open order(s) must be completed before closing shift
                  </p>
                </div>
              )}
            </div>

            {mode === "close" && (
              <div className="border-t border-border px-6 py-4">
                {/* Cash drawer count */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-text-muted">Cash in Drawer (RM)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    placeholder="Count your cash..."
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg font-semibold text-center focus:border-brand focus:outline-none"
                  />
                  {closingCash && (
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-text-muted">Opening float</span>
                        <span>{displayRM((currentShift as any).opening_float ?? 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">Cash sales</span>
                        <span>{displayRM(byMethod["Cash"]?.total ?? 0)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span className="text-text-muted">Expected</span>
                        <span>{displayRM(((currentShift as any).opening_float ?? 0) + (byMethod["Cash"]?.total ?? 0))}</span>
                      </div>
                      <div className={`flex justify-between font-bold ${
                        Math.round(parseFloat(closingCash) * 100) === ((currentShift as any).opening_float ?? 0) + (byMethod["Cash"]?.total ?? 0)
                          ? "text-success" : "text-warning"
                      }`}>
                        <span>Difference</span>
                        <span>{displayRM(Math.round(parseFloat(closingCash) * 100) - ((currentShift as any).opening_float ?? 0) - (byMethod["Cash"]?.total ?? 0))}</span>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCloseShift}
                  className="w-full rounded-xl bg-danger py-3 text-sm font-semibold text-white hover:bg-danger/80"
                >
                  Close Shift
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
