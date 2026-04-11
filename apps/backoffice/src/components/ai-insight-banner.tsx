"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, ChevronDown, ChevronUp, Loader2, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

// ─── Types (shared with AI decisions API) ──────────────────────────────

type ReorderItem = {
  productId: string; productName: string; sku: string; baseUom: string;
  currentQty: number; parLevel: number; reorderPoint: number; avgDailyUsage: number;
  orderQty: number; unitPrice: number; totalPrice: number;
  productPackageId: string | null; packageName: string | null; daysUntilStockout: number;
};

type PORecommendation = {
  type: "purchase_order"; outletId: string; outletName: string; outletCode: string;
  supplierId: string; supplierName: string; leadTimeDays: number;
  items: ReorderItem[]; totalAmount: number; urgency: "critical" | "low" | "restock";
};

type TransferRecommendation = {
  type: "transfer"; fromOutletId: string; fromOutletName: string;
  toOutletId: string; toOutletName: string;
  items: { productId: string; productName: string; fromQty: number; toQty: number; transferQty: number; toParLevel: number; packageName: string | null; packageId: string | null; conversionFactor: number; baseUom: string }[];
  reason: string;
};

type WastageAlert = {
  type: "wastage_alert"; productId: string; productName: string;
  outletId: string; outletName: string; totalWasted: number;
  wasteCost: number; adjustmentType: string; suggestion: string;
};

type AIData = {
  purchaseOrders: PORecommendation[];
  transfers: TransferRecommendation[];
  wastageAlerts: WastageAlert[];
  summary: { totalPOsToCreate: number; totalReorderValue: number; criticalPOs: number; transfersNeeded: number; wastageAlertCount: number };
};

const URGENCY_STYLE = {
  critical: { label: "OUT OF STOCK", cls: "bg-red-50 text-red-700 border-red-200" },
  low: { label: "LOW STOCK", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  restock: { label: "RESTOCK", cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
};

// ─── Banner Component ──────────────────────────────────────────────────

export function AIInsightBanner({
  type,
  onCreated,
}: {
  type: "purchaseOrders" | "transfers" | "wastageAlerts";
  onCreated?: () => void;
}) {
  const [data, setData] = useState<AIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/ai-decisions");
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Execute actions
  const executePO = async (po: PORecommendation) => {
    const key = `po_${po.outletId}_${po.supplierId}`;
    setExecuting(key);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchase_order", data: {
          outletId: po.outletId, supplierId: po.supplierId,
          items: po.items.map((i) => ({ productId: i.productId, productPackageId: i.productPackageId, quantity: i.orderQty, unitPrice: i.unitPrice })),
        }}),
      });
      const json = await res.json();
      if (res.ok) {
        setExecuted((prev) => new Set(prev).add(key));
        setResults((prev) => ({ ...prev, [key]: `Created ${json.created[0].orderNumber}` }));
        onCreated?.();
      } else {
        setResults((prev) => ({ ...prev, [key]: `Error: ${json.error}` }));
      }
    } catch { setResults((prev) => ({ ...prev, [key]: "Failed" })); }
    setExecuting(null);
  };

  const executeAllPOs = async () => {
    if (!data) return;
    const pending = data.purchaseOrders.filter((po) => !executed.has(`po_${po.outletId}_${po.supplierId}`));
    if (pending.length === 0) return;
    setExecuting("all_pos");
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "all_pos", data: {
          purchaseOrders: pending.map((po) => ({
            outletId: po.outletId, supplierId: po.supplierId,
            items: po.items.map((i) => ({ productId: i.productId, productPackageId: i.productPackageId, quantity: i.orderQty, unitPrice: i.unitPrice })),
          })),
        }}),
      });
      const json = await res.json();
      if (res.ok) {
        const newExecuted = new Set(executed);
        pending.forEach((po) => newExecuted.add(`po_${po.outletId}_${po.supplierId}`));
        setExecuted(newExecuted);
        setResults((prev) => ({ ...prev, all_pos: `Created ${json.created.length} ${json.created.length === 1 ? 'order' : 'orders'}` }));
        onCreated?.();
      }
    } catch { setResults((prev) => ({ ...prev, all_pos: "Failed" })); }
    setExecuting(null);
  };

  const executeTransfer = async (t: TransferRecommendation, idx: number) => {
    const key = `transfer_${idx}`;
    setExecuting(key);
    try {
      const res = await fetch("/api/inventory/ai-decisions/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transfer", data: {
          fromOutletId: t.fromOutletId, toOutletId: t.toOutletId,
          items: t.items.map((i) => ({ productId: i.productId, productPackageId: i.packageId || undefined, quantity: i.transferQty })),
        }}),
      });
      const json = await res.json();
      if (res.ok) {
        setExecuted((prev) => new Set(prev).add(key));
        setResults((prev) => ({ ...prev, [key]: "Transfer created" }));
        onCreated?.();
      } else {
        setResults((prev) => ({ ...prev, [key]: `Error: ${json.error}` }));
      }
    } catch { setResults((prev) => ({ ...prev, [key]: "Failed" })); }
    setExecuting(null);
  };

  if (loading) return null;
  if (!data) return null;

  // Get relevant items
  const items = type === "purchaseOrders" ? data.purchaseOrders
    : type === "transfers" ? data.transfers
    : data.wastageAlerts;

  if (items.length === 0) return null;

  // Banner summary
  const summaryText = type === "purchaseOrders"
    ? `${data.summary.totalPOsToCreate} reorder suggestions${data.summary.criticalPOs > 0 ? ` (${data.summary.criticalPOs} critical)` : ""} · RM ${data.summary.totalReorderValue.toLocaleString()}`
    : type === "transfers"
    ? `${data.summary.transfersNeeded} stock transfers recommended`
    : `${data.summary.wastageAlertCount} wastage alerts`;

  const bannerColor = type === "purchaseOrders" && data.summary.criticalPOs > 0
    ? "border-red-200 bg-red-50/50"
    : type === "wastageAlerts"
    ? "border-amber-200 bg-amber-50/50"
    : "border-blue-200 bg-blue-50/50";

  const iconColor = type === "purchaseOrders" && data.summary.criticalPOs > 0
    ? "text-red-500" : type === "wastageAlerts" ? "text-amber-500" : "text-blue-500";

  return (
    <div className={`rounded-xl border ${bannerColor} mb-4 overflow-hidden`}>
      {/* Banner header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className={`h-4 w-4 ${iconColor}`} />
          <span className="text-sm font-medium text-gray-900">AI Suggestions</span>
          <span className="text-xs text-gray-500">{summaryText}</span>
        </div>
        <div className="flex items-center gap-2">
          {type === "purchaseOrders" && !expanded && data.purchaseOrders.length > 1 && (
            <span
              onClick={(e) => { e.stopPropagation(); executeAllPOs(); }}
              className="px-2.5 py-1 bg-terracotta text-white text-[11px] font-medium rounded-md hover:bg-terracotta-dark cursor-pointer"
            >
              {executing === "all_pos" ? "Creating..." : results.all_pos || `Create All ${data.purchaseOrders.length} POs`}
            </span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-200/60 bg-white/60">
          {/* Purchase Orders */}
          {type === "purchaseOrders" && data.purchaseOrders.map((po) => {
            const key = `po_${po.outletId}_${po.supplierId}`;
            const isDone = executed.has(key);
            const u = URGENCY_STYLE[po.urgency];
            return (
              <div key={key} className={`border-b border-gray-100 last:border-0 ${isDone ? "opacity-50" : ""}`}>
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${u.cls}`}>{u.label}</span>
                    <span className="text-sm font-medium text-gray-900">{po.supplierName}</span>
                    <span className="text-xs text-gray-400">&rarr; {po.outletName}</span>
                    <span className="text-xs text-gray-400">{po.items.length} {po.items.length === 1 ? 'item' : 'items'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-900">RM {po.totalAmount.toLocaleString()}</span>
                    {isDone ? (
                      <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />{results[key]}</span>
                    ) : (
                      <button onClick={() => executePO(po)} disabled={!!executing}
                        className="px-2.5 py-1 bg-terracotta text-white text-[11px] font-medium rounded-md hover:bg-terracotta-dark disabled:opacity-40">
                        {executing === key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create PO"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Items detail */}
                <div className="px-4 pb-2.5">
                  <table className="w-full text-xs text-gray-500">
                    <tbody>
                      {po.items.map((item) => (
                        <tr key={item.productId} className="border-t border-gray-50">
                          <td className="py-1 text-gray-700">{item.productName} {item.packageName && <span className="text-gray-400">({item.packageName})</span>}</td>
                          <td className="py-1 text-right">Stock: <span className={item.currentQty <= 0 ? "text-red-600 font-medium" : ""}>{item.currentQty}</span></td>
                          <td className="py-1 text-right">Par: {item.parLevel}</td>
                          <td className="py-1 text-right">{item.daysUntilStockout}d left</td>
                          <td className="py-1 text-right font-medium text-gray-700">Order: {item.orderQty}</td>
                          <td className="py-1 text-right">RM {item.totalPrice.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Transfers */}
          {type === "transfers" && data.transfers.map((t, idx) => {
            const key = `transfer_${idx}`;
            const isDone = executed.has(key);
            return (
              <div key={key} className={`px-4 py-3 border-b border-gray-100 last:border-0 ${isDone ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{t.fromOutletName}</span>
                    <span className="text-xs text-gray-400 mx-2">&rarr;</span>
                    <span className="text-sm text-gray-700">{t.toOutletName}</span>
                    <span className="text-xs text-gray-400 ml-2">{t.items.length} {t.items.length === 1 ? 'item' : 'items'} · {t.reason}</span>
                  </div>
                  {isDone ? (
                    <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />{results[key]}</span>
                  ) : (
                    <button onClick={() => executeTransfer(t, idx)} disabled={!!executing}
                      className="px-2.5 py-1 bg-blue-600 text-white text-[11px] font-medium rounded-md hover:bg-blue-700 disabled:opacity-40">
                      {executing === key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Transfer"}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {t.items.map((i) => (
                    <span key={i.productId} className="text-[11px] bg-gray-100 rounded px-2 py-0.5 text-gray-600">
                      {i.productName}: {i.transferQty} {i.packageName || i.baseUom || "units"}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Wastage Alerts */}
          {type === "wastageAlerts" && data.wastageAlerts.map((w, idx) => (
            <div key={idx} className="px-4 py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-sm font-medium text-gray-900">{w.productName}</span>
                  <span className="text-xs text-gray-400">{w.outletName}</span>
                </div>
                <span className="text-xs font-medium text-red-600">-RM {w.wasteCost.toFixed(2)} ({w.totalWasted} wasted)</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-5.5">{w.suggestion}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
