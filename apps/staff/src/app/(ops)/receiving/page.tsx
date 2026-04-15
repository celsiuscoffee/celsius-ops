"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { compressImage } from "@/lib/compress-image";
import {
  Package,
  Camera,
  Check,
  AlertTriangle,
  Truck,
  FileText,
  X,
  Loader2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrderItem {
  id: string;
  productId: string;
  product: string;
  sku: string;
  uom: string;
  shelfLifeDays: number | null;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  supplier: string;
  supplierId: string;
  status: string;
  totalAmount: number;
  deliveryDate: string | null;
  items: OrderItem[];
}

interface ReceivingRecord {
  id: string;
  orderNumber: string;
  supplier: string;
  receivedBy: string;
  receivedAt: string;
  status: string;
  items: {
    id: string;
    product: string;
    orderedQty: number | null;
    receivedQty: number;
  }[];
}

interface ReceivedQty {
  [itemId: string]: { qty: string; hasDiscrepancy: boolean; reason?: string };
}

interface UserSession {
  id: string;
  name: string;
  outletId: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PENDING_STATUSES = ["SENT", "APPROVED", "AWAITING_DELIVERY"];

function isPerishable(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("milk") || lower.includes("cream") || lower.includes("yogurt");
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const futureDays = Math.abs(diffDays);
    if (futureDays === 1) return "Tomorrow";
    return `In ${futureDays} days`;
  }
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ReceivePage() {
  /* Data state */
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [recentReceivings, setRecentReceivings] = useState<ReceivingRecord[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  /* Form state */
  const [selectedPO, setSelectedPO] = useState<Order | null>(null);
  const [receivedQtys, setReceivedQtys] = useState<ReceivedQty>({});
  const [invoicePhotos, setInvoicePhotos] = useState<string[]>([]);
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [discrepancyReasons, setDiscrepancyReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- Fetch data ------------------------------------------------ */

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, receivingsRes, userRes] = await Promise.all([
        fetch("/api/orders?limit=100"),
        fetch("/api/receivings?limit=10"),
        fetch("/api/auth/me"),
      ]);

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        const allOrders: Order[] = data.items ?? data;
        setPendingOrders(
          allOrders.filter((o) => PENDING_STATUSES.includes(o.status)),
        );
      }

      if (receivingsRes.ok) {
        const recJson = await receivingsRes.json();
        const allReceivings: ReceivingRecord[] = recJson.data ?? recJson;
        setRecentReceivings(allReceivings.slice(0, 5));
      }

      if (userRes.ok) {
        const session = await userRes.json();
        setUser(session);
      }
    } catch (err) {
      console.error("Failed to load receiving data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ---- Actions --------------------------------------------------- */

  const openPO = (po: Order) => {
    setSelectedPO(po);
    setReceivedQtys({});
    setInvoicePhotos([]);
    setExpiryDates({});
    setDiscrepancyReasons({});
    setSubmitSuccess(false);
  };

  const updateReceivedQty = (itemId: string, qty: string) => {
    setReceivedQtys((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        qty,
        hasDiscrepancy: false,
      },
    }));
  };

  const [compressing, setCompressing] = useState(false);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setCompressing(true);
    try {
      const compressed = await Promise.all(
        Array.from(files).map((file) => compressImage(file)),
      );
      setInvoicePhotos((prev) => [...prev, ...compressed]);
    } catch (err) {
      console.error("Failed to compress image:", err);
    } finally {
      setCompressing(false);
      // Reset input so the same file can be re-selected
      e.target.value = "";
    }
  };

  const removePhoto = (index: number) => {
    setInvoicePhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const allReceived = selectedPO?.items.every(
    (item) =>
      receivedQtys[item.id]?.qty !== undefined &&
      receivedQtys[item.id]?.qty !== "",
  );

  const hasDiscrepancies = selectedPO?.items.some((item) => {
    const received = receivedQtys[item.id];
    return received && parseFloat(received.qty) !== item.quantity;
  });

  const submitReceiving = async () => {
    if (!selectedPO || !user) return;
    setSubmitting(true);

    const payload = {
      orderId: selectedPO.id,
      outletId: user.outletId,
      supplierId: selectedPO.supplierId,
      items: selectedPO.items.map((item) => {
        const receivedQty = parseFloat(receivedQtys[item.id]?.qty || "0") || 0;
        return {
          productId: item.productId,
          orderedQty: item.quantity,
          receivedQty,
          expiryDate: expiryDates[item.id] || undefined,
          discrepancyReason:
            receivedQty !== item.quantity
              ? discrepancyReasons[item.id] || "Quantity mismatch"
              : undefined,
        };
      }),
      notes: null,
      invoicePhotos,
    };

    try {
      const res = await fetch("/api/receivings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSubmitSuccess(true);
        // Brief delay to show success state before navigating back
        setTimeout(() => {
          setSelectedPO(null);
          setReceivedQtys({});
          setInvoicePhotos([]);
          setExpiryDates({});
          setDiscrepancyReasons({});
          setSubmitSuccess(false);
          fetchData(); // Refresh lists
        }, 1200);
      } else {
        console.error("Failed to submit receiving:", await res.text());
      }
    } catch (err) {
      console.error("Failed to submit receiving:", err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Render ---------------------------------------------------- */

  if (loading) {
    return (
      <>
        <TopBar title="Receive & Capture" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </>
    );
  }

  if (submitSuccess) {
    return (
      <>
        <TopBar title="Receive & Capture" />
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <Check className="h-7 w-7 text-green-600" />
          </div>
          <p className="text-sm font-medium text-gray-900">Receiving recorded</p>
          <p className="text-xs text-gray-500">Inventory will be updated shortly</p>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Receive & Capture" />

      {!selectedPO ? (
        <div className="px-4 py-3">
          <div className="mx-auto max-w-lg space-y-4">
            {/* Expected today */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Truck className="h-4 w-4 text-terracotta" />
                <h2 className="text-sm font-semibold text-gray-900">
                  Expected Today
                </h2>
                <Badge className="bg-terracotta/10 text-[10px] text-terracotta-dark">
                  {pendingOrders.length}
                </Badge>
              </div>

              {pendingOrders.length === 0 ? (
                <div className="py-6 text-center">
                  <Truck className="mx-auto h-6 w-6 text-gray-300" />
                  <p className="mt-1.5 text-xs text-gray-400">
                    No pending deliveries
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-300">
                    Orders marked as Sent will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingOrders.map((po) => (
                    <Card
                      key={po.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50 active:bg-gray-100"
                      onClick={() => openPO(po)}
                    >
                      <div className="flex items-center justify-between px-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {po.supplier}
                          </p>
                          <p className="text-xs text-gray-500">
                            {po.orderNumber} &middot; {po.items.length} items
                            &middot; RM {po.totalAmount.toFixed(2)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {po.deliveryDate
                              ? formatRelativeDate(po.deliveryDate)
                              : "Pending"}
                          </Badge>
                          <Package className="h-4 w-4 text-gray-400" />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Quick capture -- no PO linked */}
            <Card className="border-dashed border-gray-300">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center gap-3 px-3 py-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                  <Camera className="h-5 w-5 text-gray-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">
                    Quick Invoice Capture
                  </p>
                  <p className="text-xs text-gray-500">
                    Snap an invoice without linking to a PO
                  </p>
                </div>
              </button>
            </Card>

            {/* Recent */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">
                Recently Received
              </h2>
              {recentReceivings.length === 0 ? (
                <div className="py-6 text-center">
                  <Package className="mx-auto h-6 w-6 text-gray-300" />
                  <p className="mt-1.5 text-xs text-gray-400">
                    No recent receivings
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-300">
                    Tap a pending delivery above to start receiving
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {recentReceivings.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2.5"
                    >
                      <div>
                        <p className="text-sm text-gray-900">{r.supplier}</p>
                        <p className="text-xs text-gray-400">
                          {r.orderNumber} &middot;{" "}
                          {formatRelativeDate(r.receivedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {r.items.length} items
                        </span>
                        {r.status === "COMPLETE" ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Receiving detail view */
        <div className="px-4 py-3">
          <div className="mx-auto max-w-lg space-y-3">
            {/* PO header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {selectedPO.supplier}
                </h2>
                <p className="text-xs text-gray-500">
                  {selectedPO.orderNumber}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPO(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Items to receive */}
            <div className="space-y-2">
              {selectedPO.items.map((item) => {
                const received = receivedQtys[item.id];
                const receivedNum = received
                  ? parseFloat(received.qty)
                  : NaN;
                const isShort =
                  !isNaN(receivedNum) && receivedNum < item.quantity;
                const isOver =
                  !isNaN(receivedNum) && receivedNum > item.quantity;
                const isMatch =
                  !isNaN(receivedNum) && receivedNum === item.quantity;

                return (
                  <Card
                    key={item.id}
                    className={`overflow-hidden ${
                      isShort
                        ? "border-red-200"
                        : isMatch
                          ? "border-green-200"
                          : ""
                    }`}
                  >
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {item.product}
                          </p>
                          <p className="text-xs text-gray-500">
                            {item.sku} &middot; Ordered: {item.quantity}{" "}
                            {item.uom} &middot; RM{" "}
                            {item.unitPrice.toFixed(2)}/{item.uom}
                          </p>
                        </div>
                        {isMatch && (
                          <Check className="h-5 w-5 text-green-500" />
                        )}
                        {isShort && (
                          <Badge
                            variant="destructive"
                            className="text-[10px]"
                          >
                            Short {item.quantity - receivedNum} {item.uom}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <label className="text-xs text-gray-500">
                          Received:
                        </label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder={`${item.quantity}`}
                          value={received?.qty ?? ""}
                          onChange={(e) =>
                            updateReceivedQty(item.id, e.target.value)
                          }
                          className="h-8 w-24 text-center"
                        />
                        <span className="text-xs text-gray-500">
                          {item.uom}
                        </span>

                        {/* Quick match button */}
                        {!isMatch && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-green-600"
                            onClick={() =>
                              updateReceivedQty(
                                item.id,
                                String(item.quantity),
                              )
                            }
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Match
                          </Button>
                        )}
                      </div>

                      {/* Discrepancy reason */}
                      {(isShort || isOver) && (
                        <div className="mt-2">
                          <Input
                            placeholder="Reason for discrepancy..."
                            value={discrepancyReasons[item.id] ?? ""}
                            onChange={(e) =>
                              setDiscrepancyReasons((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                      )}

                      {/* Expiry date for perishables */}
                      {isPerishable(item.product) && (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-xs text-gray-500">
                            Expiry:
                          </label>
                          <Input
                            type="date"
                            value={expiryDates[item.id] ?? ""}
                            onChange={(e) =>
                              setExpiryDates((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className="h-8 w-40 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Invoice photo capture */}
            <div>
              <h3 className="mb-1.5 text-sm font-medium text-gray-900">
                Invoice Photo
              </h3>
              <div className="flex flex-wrap gap-2">
                {invoicePhotos.map((photo, i) => (
                  <div
                    key={i}
                    className="relative h-20 w-20 overflow-hidden rounded-lg border"
                  >
                    <img
                      src={photo}
                      alt={`Invoice ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {compressing ? (
                  <div className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-terracotta/30 text-terracotta">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-[10px]">Compressing</span>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-terracotta hover:text-terracotta"
                  >
                    <Camera className="h-5 w-5" />
                    <span className="text-[10px]">Add Photo</span>
                  </button>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="pb-16">
              {hasDiscrepancies && (
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-terracotta/5 px-3 py-2 text-xs text-terracotta-dark">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Some quantities don&apos;t match. Discrepancies will be
                    flagged for follow-up.
                  </span>
                </div>
              )}
              <Button
                className="w-full bg-terracotta hover:bg-terracotta-dark"
                disabled={!allReceived || submitting}
                onClick={submitReceiving}
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-1.5 h-4 w-4" />
                )}
                {submitting ? "Submitting..." : "Confirm Received"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for camera/gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handlePhotoCapture}
      />
    </>
  );
}
