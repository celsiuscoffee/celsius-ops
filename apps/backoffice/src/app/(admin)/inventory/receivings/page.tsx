"use client";

import React, { useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useFetch } from "@/lib/use-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronDown,
  Loader2,
  Package,
  CheckCircle2,
  AlertTriangle,
  Camera,
  ClipboardCheck,
  Plus,
  Truck,
  Clock,
} from "lucide-react";

type ReceivingItem = {
  id: string;
  product: string;
  sku: string;
  package: string;
  orderedQty: number | null;
  receivedQty: number;
  expiryDate: string | null;
  discrepancyReason: string | null;
};

type Receiving = {
  id: string;
  orderId: string | null;
  orderNumber: string;
  outlet: string;
  supplier: string;
  receivedBy: string;
  receivedAt: string;
  status: string;
  notes: string | null;
  photoCount: number;
  items: ReceivingItem[];
};

// For PO selection in the receive dialog
type POItem = {
  id: string;
  product: string;
  sku: string;
  package: string;
  quantity: number;
  productId: string;
  productPackageId: string | null;
};

type PendingOrder = {
  id: string;
  orderNumber: string;
  outlet: string;
  outletId: string;
  supplier: string;
  supplierId: string;
  items: POItem[];
  isTransfer?: boolean;
  transferId?: string;
};

type ReceiveLineItem = {
  productId: string;
  productPackageId: string | null;
  product: string;
  sku: string;
  orderedQty: number;
  alreadyReceived: number;
  receivedQty: number;
  discrepancyReason: string;
};

export default function ReceivingsPage() {
  const [tab, setTab] = useState("recent");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<"awaiting" | "all_received" | "complete" | "partial" | null>(null);

  // Main data via useFetch
  const receivingsUrl = `/api/inventory/receivings?tab=${tab}`;
  const { data: receivings = [], isLoading: recLoading, mutate: reloadReceivings } = useFetch<Receiving[]>(receivingsUrl);

  type AwaitingOrder = { id: string; orderNumber: string; outlet: string; supplier: string; status: string; totalAmount: number; items: number; deliveryDate: string | null; createdAt: string; isTransfer?: boolean; transferId?: string };
  const { data: rawActiveOrders = [], isLoading: ordLoading, mutate: reloadOrders } = useFetch<{ id: string; orderNumber: string; outlet: string; supplier: string; status: string; totalAmount: number; items: { id: string }[]; deliveryDate: string | null; createdAt: string }[]>("/api/inventory/orders?tab=active");

  // Also fetch transfers that are approved/in-transit — they need receiving too
  type TransferRaw = { id: string; fromOutlet: string; toOutlet: string; status: string; items: { id: string }[]; createdAt: string; approvedAt: string | null };
  const { data: rawTransfers = [], isLoading: tfrLoading, mutate: reloadTransfers } = useFetch<TransferRaw[]>("/api/inventory/transfers");

  const loading = recLoading || ordLoading || tfrLoading;

  const AWAITING_STATUSES = ["SENT", "APPROVED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
  const awaitingFromOrders: AwaitingOrder[] = rawActiveOrders
    .filter((o) => AWAITING_STATUSES.includes(o.status))
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      outlet: o.outlet,
      supplier: o.supplier,
      status: o.status,
      totalAmount: o.totalAmount,
      items: o.items.length,
      deliveryDate: o.deliveryDate,
      createdAt: o.createdAt,
    }));

  // Approved / In-Transit transfers show as awaiting delivery
  const TRANSFER_AWAITING = ["APPROVED", "IN_TRANSIT"];
  const awaitingFromTransfers: AwaitingOrder[] = rawTransfers
    .filter((t) => TRANSFER_AWAITING.includes(t.status))
    .map((t) => ({
      id: `transfer-${t.id}`,
      orderNumber: `TFR from ${t.fromOutlet}`,
      outlet: t.toOutlet,
      supplier: t.fromOutlet,
      status: t.status,
      totalAmount: 0,
      items: t.items.length,
      deliveryDate: null,
      createdAt: t.createdAt,
      isTransfer: true,
      transferId: t.id,
    }));

  const awaitingOrders = [...awaitingFromOrders, ...awaitingFromTransfers];

  const loadData = () => { reloadReceivings(); reloadOrders(); reloadTransfers(); };

  // Receive dialog state
  const [showReceive, setShowReceive] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [receiveItems, setReceiveItems] = useState<ReceiveLineItem[]>([]);
  const [receiveNotes, setReceiveNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Store pending orders in ref so selectOrder can access fresh data immediately
  const pendingOrdersRef = React.useRef<PendingOrder[]>([]);

  const openReceiveDialog = async (autoSelectOrderId?: string) => {
    // Fetch orders and transfers in parallel
    const [ordersRes, transfersRes] = await Promise.all([
      fetch("/api/inventory/orders?tab=active"),
      fetch("/api/inventory/transfers"),
    ]);
    const orders = ordersRes.ok ? await ordersRes.json() : [];
    const transfers = transfersRes.ok ? await transfersRes.json() : [];

    const pendingFromOrders: PendingOrder[] = orders
      .filter((o: { status: string }) =>
        ["SENT", "AWAITING_DELIVERY", "APPROVED", "PARTIALLY_RECEIVED"].includes(o.status),
      )
      .map((o: { id: string; orderNumber: string; outlet: string; outletId: string; outletCode: string; supplierId: string; supplier: string; supplierPhone: string; items: { id: string; productId: string; product: string; sku: string; package: string; quantity: number; productPackageId?: string }[] }) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        outlet: o.outlet,
        outletId: o.outletId,
        supplier: o.supplier,
        supplierId: o.supplierId,
        items: o.items.map((i) => ({
          ...i,
          productId: i.productId,
          productPackageId: i.productPackageId ?? null,
        })),
      }));

    // Map IN_TRANSIT / APPROVED transfers as pending orders
    const pendingFromTransfers: PendingOrder[] = transfers
      .filter((t: { status: string }) => ["PENDING_APPROVAL", "APPROVED", "IN_TRANSIT", "PENDING"].includes(t.status))
      .map((t: { id: string; fromOutlet: string; toOutlet: string; toOutletId: string; status: string; items: { id: string; productId: string; productPackageId: string | null; product: string; sku: string; package: string; quantity: number }[] }) => ({
        id: `transfer-${t.id}`,
        orderNumber: `TFR (Transfer from ${t.fromOutlet})`,
        outlet: t.toOutlet,
        outletId: t.toOutletId,
        supplier: t.fromOutlet,
        supplierId: "",
        isTransfer: true,
        transferId: t.id,
        items: t.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productPackageId: i.productPackageId,
          product: i.product,
          sku: i.sku,
          package: i.package,
          quantity: i.quantity,
        })),
      }));

    const pending = [...pendingFromOrders, ...pendingFromTransfers];
    setPendingOrders(pending);
    pendingOrdersRef.current = pending;
    setSelectedOrderId("");
    setReceiveItems([]);
    setReceiveNotes("");
    setShowReceive(true);

    // Auto-select order if provided
    if (autoSelectOrderId) {
      selectOrder(autoSelectOrderId, pending);
    }
  };

  const selectOrder = async (orderId: string, ordersList?: PendingOrder[]) => {
    setSelectedOrderId(orderId);
    const orders = ordersList || pendingOrdersRef.current || pendingOrders;
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    // Fetch previous receivings for this order to calculate remaining balance
    let prevReceived: Record<string, number> = {};
    try {
      const res = await fetch(`/api/inventory/receivings?orderId=${orderId}`);
      if (res.ok) {
        const prev: Receiving[] = await res.json();
        for (const r of prev) {
          for (const item of r.items) {
            // Key by product name since productId isn't in the receiving response
            prevReceived[item.product] = (prevReceived[item.product] || 0) + item.receivedQty;
          }
        }
      }
    } catch { /* ignore — will default to full qty */ }

    setReceiveItems(
      order.items.map((i) => {
        const alreadyReceived = prevReceived[i.product] || 0;
        const remaining = Math.max(0, i.quantity - alreadyReceived);
        return {
          productId: i.productId,
          productPackageId: i.productPackageId,
          product: i.product,
          sku: i.sku,
          orderedQty: i.quantity,
          alreadyReceived,
          receivedQty: remaining, // Default to remaining balance
          discrepancyReason: "",
        };
      }),
    );
  };

  const updateReceivedQty = (idx: number, qty: number) => {
    setReceiveItems(receiveItems.map((item, i) =>
      i === idx ? { ...item, receivedQty: Math.max(0, qty) } : item,
    ));
  };

  const updateDiscrepancy = (idx: number, reason: string) => {
    setReceiveItems(receiveItems.map((item, i) =>
      i === idx ? { ...item, discrepancyReason: reason } : item,
    ));
  };

  const submitReceiving = async () => {
    if (!selectedOrderId || receiveItems.length === 0) return;
    setSaving(true);
    try {
      const selectedOrder = pendingOrders.find((o) => o.id === selectedOrderId);
      if (!selectedOrder) return;

      const outletId = selectedOrder.outletId;
      const isTransfer = !!selectedOrder.isTransfer;

      if (!outletId) {
        alert("Missing outlet ID. Please try again.");
        setSaving(false);
        return;
      }

      if (!isTransfer && !selectedOrder.supplierId) {
        alert("Missing supplier ID. Please try again.");
        setSaving(false);
        return;
      }

      const itemsToSubmit = receiveItems
        .filter((i) => i.receivedQty > 0)
        .map((i) => ({
          productId: i.productId,
          productPackageId: i.productPackageId,
          orderedQty: i.orderedQty,
          receivedQty: i.receivedQty,
          discrepancyReason: i.receivedQty < i.orderedQty ? (i.discrepancyReason || "short") : null,
        }));

      if (itemsToSubmit.length === 0) {
        alert("Please enter received quantities for at least one item.");
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        outletId,
        notes: receiveNotes || null,
        items: itemsToSubmit,
      };

      if (isTransfer) {
        payload.transferId = selectedOrder.transferId;
      } else {
        payload.orderId = selectedOrder.id;
        payload.supplierId = selectedOrder.supplierId;
      }

      await fetch("/api/inventory/receivings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setShowReceive(false);
      loadData();
    } finally {
      setSaving(false);
    }
  };

  const filtered = receivings.filter((r) => {
    // Search filter
    const matchesSearch =
      r.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.supplier.toLowerCase().includes(search.toLowerCase()) ||
      r.outlet.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    // Card filter
    if (cardFilter === "complete") return r.status === "COMPLETE";
    if (cardFilter === "partial") return r.status !== "COMPLETE";
    return true; // "all_received" or null shows all
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Receivings</h2>
          <p className="mt-0.5 text-sm text-gray-500">{receivings.length} delivery records</p>
        </div>
        <Button className="bg-terracotta hover:bg-terracotta-dark" onClick={() => openReceiveDialog()}>
          <ClipboardCheck className="mr-1.5 h-4 w-4" />Record Delivery
        </Button>
      </div>

      {/* Summary — clickable to filter */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          { key: "awaiting" as const, label: "Awaiting Delivery", count: awaitingOrders.length, color: "text-purple-600", border: "border-purple-400", ring: "ring-purple-100" },
          { key: "all_received" as const, label: "Total Received", count: receivings.length, color: "text-gray-900", border: "border-gray-400", ring: "ring-gray-100" },
          { key: "complete" as const, label: "Complete", count: receivings.filter((r) => r.status === "COMPLETE").length, color: "text-green-600", border: "border-green-400", ring: "ring-green-100" },
          { key: "partial" as const, label: "Partial / Disputed", count: receivings.filter((r) => r.status !== "COMPLETE").length, color: "text-amber-600", border: "border-amber-400", ring: "ring-amber-100" },
        ]).map((card) => (
          <button
            key={card.key}
            onClick={() => setCardFilter(cardFilter === card.key ? null : card.key)}
            className={`rounded-lg border bg-white px-4 py-3 text-left transition-all hover:shadow-sm cursor-pointer ${
              cardFilter === card.key
                ? `${card.border} ring-2 ${card.ring} shadow-sm`
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.count}</p>
          </button>
        ))}
      </div>

      {/* Awaiting Delivery */}
      {awaitingOrders.length > 0 && (!cardFilter || cardFilter === "awaiting") && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Truck className="h-4 w-4 text-purple-500" />
            Awaiting Delivery
            <Badge className="bg-purple-500 text-[10px]">{awaitingOrders.length}</Badge>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {awaitingOrders.map((o) => (
              <Card
                key={o.id}
                className={`cursor-pointer px-4 py-3 transition-colors hover:bg-gray-50 ${o.status === "PARTIALLY_RECEIVED" ? "border-amber-300 bg-amber-50/30" : o.isTransfer ? "border-blue-200 bg-blue-50/30" : ""}`}
                onClick={() => openReceiveDialog(o.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{o.supplier}</p>
                    <p className="text-xs text-gray-500">{o.orderNumber} &middot; {o.items} items{o.totalAmount > 0 ? ` · RM ${o.totalAmount.toFixed(2)}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <Badge className={`text-[10px] ${o.status === "PARTIALLY_RECEIVED" ? "bg-amber-500" : o.isTransfer ? "bg-blue-500" : "bg-purple-500"}`}>
                      {o.isTransfer ? "TRANSFER" : o.status.replace(/_/g, " ")}
                    </Badge>
                    {o.deliveryDate && (
                      <p className="mt-0.5 text-[10px] text-gray-400">Due: {o.deliveryDate}</p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">{o.outlet}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Search & Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by PO#, supplier, or outlet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {([["recent", "Recent"], ["all", "All"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${tab === value ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Receivings Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">PO Reference</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Photos</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Received By</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Package className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {receivings.length === 0
                      ? "No receivings yet. Click 'Record Delivery' to log a delivery."
                      : "No receivings match your search."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((rec) => (
              <Fragment key={rec.id}>
                <tr
                  className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                >
                  <td className="px-3 py-3">
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === rec.id ? "rotate-180" : ""}`} />
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{rec.orderNumber}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{rec.outlet}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{rec.supplier}</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${rec.status === "COMPLETE" ? "bg-green-500" : rec.status === "PARTIAL" ? "bg-amber-500" : "bg-red-500"}`}>
                      {rec.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{rec.items.length} items</td>
                  <td className="px-4 py-3">
                    {rec.photoCount > 0 ? (
                      <span className="flex items-center gap-1 text-xs text-gray-500"><Camera className="h-3 w-3" />{rec.photoCount}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{rec.receivedBy}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(rec.receivedAt).toLocaleDateString("en-MY")}
                  </td>
                </tr>
                {expandedId === rec.id && (
                  <tr>
                    <td colSpan={9} className="bg-gray-50 px-8 py-3">
                      <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">Received Items</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="pb-1 text-left font-medium">Product</th>
                            <th className="pb-1 text-left font-medium">SKU</th>
                            <th className="pb-1 text-right font-medium">Ordered</th>
                            <th className="pb-1 text-right font-medium">Received</th>
                            <th className="pb-1 text-left font-medium">Status</th>
                            <th className="pb-1 text-left font-medium">Expiry</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rec.items.map((item) => {
                            const match = item.orderedQty === null || item.receivedQty === item.orderedQty;
                            const short = item.orderedQty !== null && item.receivedQty < item.orderedQty;
                            return (
                              <tr key={item.id} className="border-t border-gray-200/50">
                                <td className="py-1.5 text-gray-700">{item.product}</td>
                                <td className="py-1.5"><code className="text-gray-500">{item.sku}</code></td>
                                <td className="py-1.5 text-right text-gray-500">{item.orderedQty ?? "—"}</td>
                                <td className="py-1.5 text-right text-gray-700 font-medium">{item.receivedQty}</td>
                                <td className="py-1.5">
                                  {match ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                  ) : short ? (
                                    <span className="flex items-center gap-1 text-red-500">
                                      <AlertTriangle className="h-3 w-3" />
                                      Short{item.discrepancyReason ? ` (${item.discrepancyReason})` : ""}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-1.5 text-gray-500">{item.expiryDate ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {rec.notes && <p className="mt-2 text-xs text-gray-500">Notes: {rec.notes}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Record Delivery Dialog */}
      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Delivery</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Select Purchase Order or Transfer</label>
              <select
                value={selectedOrderId}
                onChange={(e) => selectOrder(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select a PO or Transfer...</option>
                {pendingOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} — {o.supplier} ({o.outlet})
                  </option>
                ))}
              </select>
              {pendingOrders.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">No pending orders or transfers to receive.</p>
              )}
            </div>

            {/* Receive items */}
            {selectedOrderId && receiveItems.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">This order has no items.</p>
            )}
            {receiveItems.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Enter Received Quantities</label>
                <div className="rounded-md border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-gray-50 text-gray-500">
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-right font-medium">Ordered</th>
                        <th className="px-3 py-2 text-right font-medium">Prev Recv</th>
                        <th className="px-3 py-2 text-right font-medium">Balance</th>
                        <th className="px-3 py-2 text-center font-medium w-24">This Delivery</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiveItems.map((item, idx) => {
                        const remaining = item.orderedQty - item.alreadyReceived;
                        const isShort = item.receivedQty < remaining;
                        const isOver = item.receivedQty > remaining;
                        return (
                          <tr key={idx} className="border-b border-gray-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-700">{item.product}</div>
                              <code className="text-gray-400">{item.sku}</code>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600">{item.orderedQty}</td>
                            <td className="px-3 py-2 text-right text-gray-400">
                              {item.alreadyReceived > 0 ? item.alreadyReceived : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-purple-600">{remaining}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={item.receivedQty}
                                onChange={(e) => updateReceivedQty(idx, parseInt(e.target.value) || 0)}
                                className={`w-16 rounded border px-2 py-1 text-center ${isShort ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                                min={0}
                              />
                            </td>
                            <td className="px-3 py-2">
                              {item.receivedQty === remaining ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : isShort ? (
                                <span className="flex items-center gap-1 text-red-500">
                                  <AlertTriangle className="h-3 w-3" />
                                  Short {remaining - item.receivedQty}
                                </span>
                              ) : isOver ? (
                                <span className="text-blue-500 text-xs">Over +{item.receivedQty - remaining}</span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              {isShort && (
                                <select
                                  value={item.discrepancyReason}
                                  onChange={(e) => updateDiscrepancy(idx, e.target.value)}
                                  className="rounded border border-gray-200 px-2 py-1 text-xs"
                                >
                                  <option value="">Reason...</option>
                                  <option value="short">Short delivery</option>
                                  <option value="damaged">Damaged</option>
                                  <option value="wrong_item">Wrong item</option>
                                  <option value="expired">Expired</option>
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
              <Input placeholder="Any delivery notes..." value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={submitReceiving}
              disabled={saving || !selectedOrderId || receiveItems.length === 0}
              className="bg-terracotta hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
              Confirm Delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
