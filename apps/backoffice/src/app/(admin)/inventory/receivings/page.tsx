"use client";

import { useState, useEffect, Fragment } from "react";
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
};

type ReceiveLineItem = {
  productId: string;
  productPackageId: string | null;
  product: string;
  sku: string;
  orderedQty: number;
  receivedQty: number;
  discrepancyReason: string;
};

export default function ReceivingsPage() {
  const [tab, setTab] = useState("recent");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Main data via useFetch
  const receivingsUrl = `/api/inventory/receivings?tab=${tab}`;
  const { data: receivings = [], isLoading: recLoading, mutate: reloadReceivings } = useFetch<Receiving[]>(receivingsUrl);

  type AwaitingOrder = { id: string; orderNumber: string; outlet: string; supplier: string; status: string; totalAmount: number; items: number; deliveryDate: string | null; createdAt: string };
  const { data: rawActiveOrders = [], isLoading: ordLoading, mutate: reloadOrders } = useFetch<{ id: string; orderNumber: string; outlet: string; supplier: string; status: string; totalAmount: number; items: { id: string }[]; deliveryDate: string | null; createdAt: string }[]>("/api/inventory/orders?tab=active");

  const loading = recLoading || ordLoading;

  const AWAITING_STATUSES = ["SENT", "APPROVED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
  const awaitingOrders: AwaitingOrder[] = rawActiveOrders
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

  const loadData = () => { reloadReceivings(); reloadOrders(); };

  // Receive dialog state
  const [showReceive, setShowReceive] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [receiveItems, setReceiveItems] = useState<ReceiveLineItem[]>([]);
  const [receiveNotes, setReceiveNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const openReceiveDialog = () => {
    // Fetch orders that are awaiting delivery or sent
    fetch("/api/inventory/orders?tab=active")
      .then((r) => r.json())
      .then((orders) => {
        const pending: PendingOrder[] = orders
          .filter((o: { status: string }) =>
            ["SENT", "AWAITING_DELIVERY", "APPROVED", "PARTIALLY_RECEIVED"].includes(o.status),
          )
          .map((o: { id: string; orderNumber: string; outlet: string; outletCode: string; supplier: string; supplierPhone: string; items: { id: string; product: string; sku: string; package: string; quantity: number }[] }) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            outlet: o.outlet,
            outletId: "", // We'll need this from the full order
            supplier: o.supplier,
            supplierId: "",
            items: o.items.map((i) => ({
              ...i,
              productId: "",
              productPackageId: null,
            })),
          }));
        setPendingOrders(pending);
        setSelectedOrderId("");
        setReceiveItems([]);
        setReceiveNotes("");
        setShowReceive(true);
      });
  };

  const selectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    const order = pendingOrders.find((o) => o.id === orderId);
    if (order) {
      setReceiveItems(
        order.items.map((i) => ({
          productId: i.productId,
          productPackageId: i.productPackageId,
          product: i.product,
          sku: i.sku,
          orderedQty: i.quantity,
          receivedQty: i.quantity, // Default to full quantity
          discrepancyReason: "",
        })),
      );
    }
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
      // We need outletId and supplierId - fetch the full order
      const orderRes = await fetch("/api/inventory/orders");
      const allOrders = await orderRes.json();
      const fullOrder = allOrders.find((o: { id: string }) => o.id === selectedOrderId);
      if (!fullOrder) return;

      // We need the actual IDs - fetch from the order API with IDs
      const orderDetailRes = await fetch(`/api/inventory/orders/${selectedOrderId}`);
      let outletId = "";
      let supplierId = "";

      if (orderDetailRes.ok) {
        const detail = await orderDetailRes.json();
        outletId = detail.outletId;
        supplierId = detail.supplierId;
      }

      // Fallback: look up outlet and supplier by name
      if (!outletId || !supplierId) {
        const [outletsRes, suppliersRes] = await Promise.all([
          fetch("/api/settings/outlets"),
          fetch("/api/inventory/suppliers/products"),
        ]);
        const outletsData = await outletsRes.json();
        const suppliers = await suppliersRes.json();
        const outletMatch = outletsData.find((b: { name: string }) => b.name === fullOrder.outlet);
        const supplier = suppliers.find((s: { name: string }) => s.name === fullOrder.supplier);
        outletId = outletMatch?.id ?? "";
        supplierId = supplier?.id ?? "";
      }

      await fetch("/api/inventory/receivings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrderId,
          outletId,
          supplierId,
          notes: receiveNotes || null,
          items: receiveItems.map((i) => ({
            productId: i.productId,
            productPackageId: i.productPackageId,
            orderedQty: i.orderedQty,
            receivedQty: i.receivedQty,
            discrepancyReason: i.receivedQty < i.orderedQty ? (i.discrepancyReason || "short") : null,
          })),
        }),
      });
      setShowReceive(false);
      loadData();
    } finally {
      setSaving(false);
    }
  };

  const filtered = receivings.filter((r) =>
    r.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
    r.supplier.toLowerCase().includes(search.toLowerCase()) ||
    r.outlet.toLowerCase().includes(search.toLowerCase()),
  );

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
        <Button className="bg-terracotta hover:bg-terracotta-dark" onClick={openReceiveDialog}>
          <ClipboardCheck className="mr-1.5 h-4 w-4" />Record Delivery
        </Button>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-4 gap-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Awaiting Delivery</p>
          <p className="text-xl font-bold text-purple-600">{awaitingOrders.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Received</p>
          <p className="text-xl font-bold text-gray-900">{receivings.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Complete</p>
          <p className="text-xl font-bold text-green-600">{receivings.filter((r) => r.status === "COMPLETE").length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Partial / Disputed</p>
          <p className="text-xl font-bold text-amber-600">{receivings.filter((r) => r.status !== "COMPLETE").length}</p>
        </Card>
      </div>

      {/* Awaiting Delivery */}
      {awaitingOrders.length > 0 && (
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
                className="cursor-pointer px-4 py-3 transition-colors hover:bg-gray-50"
                onClick={() => {
                  openReceiveDialog();
                  // Auto-select this order after dialog opens
                  setTimeout(() => selectOrder(o.id), 300);
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{o.supplier}</p>
                    <p className="text-xs text-gray-500">{o.orderNumber} &middot; {o.items} items &middot; RM {o.totalAmount.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-purple-500 text-[10px]">{o.status.replace(/_/g, " ")}</Badge>
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
              <label className="mb-1 block text-xs font-medium text-gray-600">Select Purchase Order</label>
              <select
                value={selectedOrderId}
                onChange={(e) => selectOrder(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select a PO...</option>
                {pendingOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} — {o.supplier} ({o.outlet})
                  </option>
                ))}
              </select>
              {pendingOrders.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">No pending orders to receive. Create and send an order first.</p>
              )}
            </div>

            {/* Receive items */}
            {receiveItems.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Enter Received Quantities</label>
                <div className="rounded-md border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-gray-50 text-gray-500">
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-right font-medium">Ordered</th>
                        <th className="px-3 py-2 text-center font-medium w-24">Received</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiveItems.map((item, idx) => {
                        const isShort = item.receivedQty < item.orderedQty;
                        return (
                          <tr key={idx} className="border-b border-gray-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-700">{item.product}</div>
                              <code className="text-gray-400">{item.sku}</code>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600">{item.orderedQty}</td>
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
                              {item.receivedQty === item.orderedQty ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : isShort ? (
                                <span className="flex items-center gap-1 text-red-500">
                                  <AlertTriangle className="h-3 w-3" />
                                  Short {item.orderedQty - item.receivedQty}
                                </span>
                              ) : (
                                <span className="text-blue-500 text-xs">Over +{item.receivedQty - item.orderedQty}</span>
                              )}
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
