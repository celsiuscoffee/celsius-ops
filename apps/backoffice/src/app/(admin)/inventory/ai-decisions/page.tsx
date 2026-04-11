"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

type ReorderItem = {
  productId: string;
  productName: string;
  sku: string;
  baseUom: string;
  currentQty: number;
  parLevel: number;
  reorderPoint: number;
  avgDailyUsage: number;
  orderQty: number;
  unitPrice: number;
  totalPrice: number;
  productPackageId: string | null;
  packageName: string | null;
  daysUntilStockout: number;
};

type PORecommendation = {
  type: "purchase_order";
  outletId: string;
  outletName: string;
  outletCode: string;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  items: ReorderItem[];
  totalAmount: number;
  urgency: "critical" | "low" | "restock";
};

type TransferRecommendation = {
  type: "transfer";
  fromOutletId: string;
  fromOutletName: string;
  toOutletId: string;
  toOutletName: string;
  items: { productId: string; productName: string; fromQty: number; toQty: number; transferQty: number; toParLevel: number }[];
  reason: string;
};

type WastageAlert = {
  type: "wastage_alert";
  productId: string;
  productName: string;
  outletId: string;
  outletName: string;
  totalWasted: number;
  wasteCost: number;
  adjustmentType: string;
  suggestion: string;
};

type AIData = {
  purchaseOrders: PORecommendation[];
  transfers: TransferRecommendation[];
  wastageAlerts: WastageAlert[];
  summary: {
    totalPOsToCreate: number;
    totalReorderValue: number;
    criticalPOs: number;
    transfersNeeded: number;
    wastageAlertCount: number;
  };
};

const URGENCY = {
  critical: { label: "OUT OF STOCK", bg: "bg-red-500/20 text-red-400 border-red-500/40", dot: "bg-red-500 animate-pulse" },
  low: { label: "LOW STOCK", bg: "bg-orange-500/20 text-orange-400 border-orange-500/40", dot: "bg-orange-500" },
  restock: { label: "RESTOCK", bg: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40", dot: "bg-yellow-500" },
};

// ─── Page ───────────────────────────────────────────────────────────────

export default function AIDecisionsPage() {
  const [data, setData] = useState<AIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/ai-decisions");
      if (!res.ok) throw new Error("Failed");
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Execute a single PO
  const executePO = async (po: PORecommendation) => {
    const key = `po_${po.outletId}_${po.supplierId}`;
    setExecuting(key);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchase_order",
          data: {
            outletId: po.outletId,
            supplierId: po.supplierId,
            items: po.items.map((i) => ({
              productId: i.productId,
              productPackageId: i.productPackageId,
              quantity: i.orderQty,
              unitPrice: i.unitPrice,
            })),
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setExecuted((prev) => new Set(prev).add(key));
        setResults((prev) => ({ ...prev, [key]: `Created ${json.created[0].orderNumber}` }));
      } else {
        setResults((prev) => ({ ...prev, [key]: `Error: ${json.error}` }));
      }
    } catch {
      setResults((prev) => ({ ...prev, [key]: "Failed to create" }));
    } finally {
      setExecuting(null);
    }
  };

  // Execute all POs
  const executeAllPOs = async () => {
    if (!data) return;
    const pending = data.purchaseOrders.filter((po) => !executed.has(`po_${po.outletId}_${po.supplierId}`));
    if (pending.length === 0) return;

    setExecuting("all_pos");
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "all_pos",
          data: {
            purchaseOrders: pending.map((po) => ({
              outletId: po.outletId,
              supplierId: po.supplierId,
              items: po.items.map((i) => ({
                productId: i.productId,
                productPackageId: i.productPackageId,
                quantity: i.orderQty,
                unitPrice: i.unitPrice,
              })),
            })),
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        const newExecuted = new Set(executed);
        pending.forEach((po) => newExecuted.add(`po_${po.outletId}_${po.supplierId}`));
        setExecuted(newExecuted);
        setResults((prev) => ({
          ...prev,
          all_pos: `Created ${json.created.length} ${json.created.length === 1 ? 'order' : 'orders'}: ${json.created.map((o: { orderNumber: string }) => o.orderNumber).join(", ")}`,
        }));
      }
    } catch {
      setResults((prev) => ({ ...prev, all_pos: "Failed" }));
    } finally {
      setExecuting(null);
    }
  };

  // Execute a transfer
  const executeTransfer = async (t: TransferRecommendation, idx: number) => {
    const key = `transfer_${idx}`;
    setExecuting(key);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer",
          data: {
            fromOutletId: t.fromOutletId,
            toOutletId: t.toOutletId,
            items: t.items.map((i) => ({ productId: i.productId, quantity: i.transferQty })),
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setExecuted((prev) => new Set(prev).add(key));
        setResults((prev) => ({ ...prev, [key]: "Transfer created" }));
      } else {
        setResults((prev) => ({ ...prev, [key]: `Error: ${json.error}` }));
      }
    } catch {
      setResults((prev) => ({ ...prev, [key]: "Failed" }));
    } finally {
      setExecuting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-6">AI Inventory Decisions</h1>
        <div className="flex items-center gap-3 py-20 justify-center">
          <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <span className="text-zinc-400 text-sm">Analysing stock levels, par levels, supplier pricing...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">AI Inventory Decisions</h1>
        <p className="text-zinc-400">Failed to load. <button onClick={fetchData} className="text-purple-400 underline">Retry</button></p>
      </div>
    );
  }

  const { purchaseOrders, transfers, wastageAlerts, summary } = data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">AI Inventory Decisions</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Auto-reorder, stock balancing, wastage control</p>
        </div>
        <button onClick={fetchData} className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-700 text-xs">
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="flex gap-3 text-xs">
        {summary.criticalPOs > 0 && (
          <span className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 font-medium">
            {summary.criticalPOs} critical reorders
          </span>
        )}
        <span className="px-3 py-1.5 bg-zinc-800 rounded-lg text-zinc-300">
          {summary.totalPOsToCreate} POs &bull; RM {summary.totalReorderValue.toLocaleString()}
        </span>
        {summary.transfersNeeded > 0 && (
          <span className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400">
            {summary.transfersNeeded} transfers needed
          </span>
        )}
        {summary.wastageAlertCount > 0 && (
          <span className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            {summary.wastageAlertCount} wastage alerts
          </span>
        )}
      </div>

      {/* ─── PURCHASE ORDERS ────────────────────────────────────────── */}
      {purchaseOrders.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Purchase Orders to Create</h2>
            {purchaseOrders.length > 1 && (
              <button
                onClick={executeAllPOs}
                disabled={executing === "all_pos" || purchaseOrders.every((po) => executed.has(`po_${po.outletId}_${po.supplierId}`))}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {executing === "all_pos" ? "Creating..." : results.all_pos ? results.all_pos : `Create All ${purchaseOrders.length} POs`}
              </button>
            )}
          </div>

          <div className="space-y-3">
            {purchaseOrders.map((po) => {
              const key = `po_${po.outletId}_${po.supplierId}`;
              const isDone = executed.has(key);
              const u = URGENCY[po.urgency];

              return (
                <div key={key} className={`bg-zinc-900 border rounded-lg overflow-hidden ${isDone ? "border-emerald-500/30 opacity-60" : po.urgency === "critical" ? "border-red-500/30" : "border-zinc-800"}`}>
                  {/* PO Header */}
                  <div className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${u.dot}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{po.supplierName}</span>
                          <span className="text-xs text-zinc-500">&rarr;</span>
                          <span className="text-xs text-zinc-400">{po.outletName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${u.bg}`}>{u.label}</span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {po.items.length} {po.items.length === 1 ? 'item' : 'items'} &bull; Lead time: {po.leadTimeDays}d
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-white">RM {po.totalAmount.toLocaleString()}</span>
                      {isDone ? (
                        <span className="text-xs text-emerald-400 font-medium">{results[key]}</span>
                      ) : (
                        <button
                          onClick={() => executePO(po)}
                          disabled={!!executing}
                          className="px-3 py-1.5 bg-zinc-700 text-white text-xs rounded-lg hover:bg-zinc-600 disabled:opacity-40"
                        >
                          {executing === key ? "Creating..." : "Create PO"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Items table */}
                  <div className="border-t border-zinc-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-zinc-500 bg-zinc-950/50">
                          <th className="text-left py-1.5 px-3 font-medium">Product</th>
                          <th className="text-right py-1.5 px-3 font-medium">Stock</th>
                          <th className="text-right py-1.5 px-3 font-medium">Par</th>
                          <th className="text-right py-1.5 px-3 font-medium">Days Left</th>
                          <th className="text-right py-1.5 px-3 font-medium">Order Qty</th>
                          <th className="text-right py-1.5 px-3 font-medium">Unit Price</th>
                          <th className="text-right py-1.5 px-3 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.items.map((item) => (
                          <tr key={item.productId} className="border-t border-zinc-800/50">
                            <td className="py-1.5 px-3 text-zinc-300">
                              {item.productName}
                              {item.packageName && <span className="text-zinc-500 ml-1">({item.packageName})</span>}
                            </td>
                            <td className={`py-1.5 px-3 text-right font-medium ${item.currentQty <= 0 ? "text-red-400" : item.currentQty <= item.reorderPoint ? "text-orange-400" : "text-zinc-300"}`}>
                              {item.currentQty}
                            </td>
                            <td className="py-1.5 px-3 text-right text-zinc-400">{item.parLevel}</td>
                            <td className={`py-1.5 px-3 text-right ${item.daysUntilStockout <= 1 ? "text-red-400 font-medium" : item.daysUntilStockout <= 3 ? "text-orange-400" : "text-zinc-400"}`}>
                              {item.daysUntilStockout}d
                            </td>
                            <td className="py-1.5 px-3 text-right text-white font-medium">{item.orderQty}</td>
                            <td className="py-1.5 px-3 text-right text-zinc-400">RM {item.unitPrice.toFixed(2)}</td>
                            <td className="py-1.5 px-3 text-right text-zinc-300">RM {item.totalPrice.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {purchaseOrders.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-zinc-400 text-sm">All stock levels are healthy. No reorders needed.</p>
        </div>
      )}

      {/* ─── TRANSFERS ──────────────────────────────────────────────── */}
      {transfers.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-white mb-3">Stock Transfers</h2>
          <div className="space-y-3">
            {transfers.map((t, idx) => {
              const key = `transfer_${idx}`;
              const isDone = executed.has(key);

              return (
                <div key={key} className={`bg-zinc-900 border rounded-lg p-3 ${isDone ? "border-emerald-500/30 opacity-60" : "border-blue-500/20"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{t.fromOutletName}</span>
                      <span className="text-blue-400">&rarr;</span>
                      <span className="text-sm text-white font-medium">{t.toOutletName}</span>
                      <span className="text-xs text-zinc-500">{t.items.length} {t.items.length === 1 ? 'item' : 'items'}</span>
                    </div>
                    {isDone ? (
                      <span className="text-xs text-emerald-400">{results[key]}</span>
                    ) : (
                      <button
                        onClick={() => executeTransfer(t, idx)}
                        disabled={!!executing}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40"
                      >
                        {executing === key ? "Creating..." : "Create Transfer"}
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 space-y-0.5">
                    {t.items.map((item) => (
                      <div key={item.productId} className="flex items-center gap-2">
                        <span className="text-zinc-400">{item.productName}</span>
                        <span className="text-zinc-600">|</span>
                        <span>from: {item.fromQty} &rarr; transfer: <span className="text-blue-400 font-medium">{item.transferQty}</span> &rarr; to gets: {item.toQty} + {item.transferQty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── WASTAGE ALERTS ─────────────────────────────────────────── */}
      {wastageAlerts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-white mb-3">Wastage Alerts (30d)</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 bg-zinc-950/50">
                  <th className="text-left py-2 px-3 font-medium">Product</th>
                  <th className="text-left py-2 px-3 font-medium">Outlet</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-right py-2 px-3 font-medium">Qty Wasted</th>
                  <th className="text-right py-2 px-3 font-medium">Cost</th>
                  <th className="text-left py-2 px-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {wastageAlerts.map((w, i) => (
                  <tr key={i} className="border-t border-zinc-800/50">
                    <td className="py-2 px-3 text-zinc-300">{w.productName}</td>
                    <td className="py-2 px-3 text-zinc-400">{w.outletName}</td>
                    <td className="py-2 px-3 text-zinc-400">{w.adjustmentType}</td>
                    <td className="py-2 px-3 text-right text-red-400">{w.totalWasted}</td>
                    <td className="py-2 px-3 text-right text-red-400">RM {w.wasteCost.toFixed(2)}</td>
                    <td className="py-2 px-3 text-amber-400">{w.suggestion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
