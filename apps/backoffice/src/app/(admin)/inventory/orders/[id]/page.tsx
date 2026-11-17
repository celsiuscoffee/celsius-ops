"use client";

import { formatRM } from "@celsius/shared";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Truck,
  CheckCircle2,
  Pencil,
  X,
  Plus,
  Save,
  MessageCircle,
  Send,
} from "lucide-react";

type OrderItem = {
  id: string;
  productId: string;
  product: { name: string; sku: string; baseUom?: string };
  productPackage: { label: string; packageLabel?: string; packageName?: string } | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  notes: string | null;
  deliveryDate: string | null;
  outlet: { id: string; name: string };
  supplier: {
    id: string;
    name: string;
    phone?: string | null;
    depositPercent?: number | null;
    depositTermsDays?: number | null;
  } | null;
  items: OrderItem[];
  createdAt: string;
};

type EditItem = {
  id: string;
  product: string;
  sku: string;
  packageLabel: string;
  qtyStr: string;
  priceStr: string;
  removed: boolean;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "bg-sunken text-text-2" },
  APPROVED: { label: "Confirmed", color: "bg-info-soft text-info-text" },
  SENT: { label: "Sent", color: "bg-ok-soft text-ok-text" },
  AWAITING_DELIVERY: { label: "Awaiting delivery", color: "bg-info-soft text-info-text" },
  COMPLETED: { label: "Completed", color: "bg-ok-soft text-ok-text" },
};

export default function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");

  const loadOrder = useCallback(() => {
    fetch(`/api/inventory/orders/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: OrderDetail) => {
        setOrder(data);
        setEditItems(
          data.items.map((i) => ({
            id: i.id,
            product: i.product.name,
            sku: i.product.sku,
            packageLabel: i.productPackage?.packageLabel ?? i.productPackage?.label ?? "pcs",
            qtyStr: String(Number(i.quantity)),
            priceStr: Number(i.unitPrice).toFixed(2),
            removed: false,
          }))
        );
        setDeliveryDate(data.deliveryDate ? data.deliveryDate.split("T")[0] : "");
      })
      .catch(() => setError("Order not found"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const total = editItems
    .filter((i) => !i.removed)
    .reduce((sum, i) => sum + (parseFloat(i.qtyStr) || 0) * (parseFloat(i.priceStr) || 0), 0);

  const saveOrder = async (andConfirm = false) => {
    if (!order) return;
    setSaving(true);
    try {
      const itemChanges = editItems
        .filter((i) => {
          if (i.removed) return true;
          const orig = order.items.find((o) => o.id === i.id);
          if (!orig) return false;
          return (
            parseFloat(i.qtyStr) !== Number(orig.quantity) ||
            parseFloat(i.priceStr) !== Number(orig.unitPrice)
          );
        })
        .map((i) =>
          i.removed
            ? { id: i.id, remove: true }
            : { id: i.id, quantity: parseFloat(i.qtyStr) || 0, unitPrice: parseFloat(i.priceStr) || 0 }
        );

      const payload: Record<string, unknown> = {};
      if (itemChanges.length > 0) payload.items = itemChanges;
      const origDate = order.deliveryDate ? order.deliveryDate.split("T")[0] : "";
      if (deliveryDate !== origDate) payload.deliveryDate = deliveryDate || null;

      if (Object.keys(payload).length > 0) {
        await fetch(`/api/inventory/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (andConfirm) {
        await fetch(`/api/inventory/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "APPROVED" }),
        });
        // Reload to show updated status with WhatsApp button
        loadOrder();
      } else {
        router.push("/inventory/orders");
      }
    } finally {
      setSaving(false);
    }
  };

  const markAsSent = async () => {
    if (!order) return;
    setSaving(true);
    try {
      await fetch(`/api/inventory/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "AWAITING_DELIVERY" }),
      });
      router.push("/inventory/orders");
    } finally {
      setSaving(false);
    }
  };

  const buildWhatsAppUrl = () => {
    if (!order?.supplier?.phone) return "";
    const items = editItems
      .filter((i) => !i.removed)
      .map((i) => `• ${i.product} (${i.packageLabel}) × ${i.qtyStr}`).join("\n");
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nOutlet: ${order.outlet.name}\n${deliveryDate ? `Delivery: ${deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: ${formatRM(total)}\n\nThank you!`;
    const phone = order.supplier.phone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="px-4 pt-6 pb-10 md:px-8">
        <p className="text-sm text-danger-text">{error || "Order not found"}</p>
        <Link href="/inventory/orders" className="mt-2 text-sm text-brand-text hover:underline">
          Back to orders
        </Link>
      </div>
    );
  }

  const isDraft = order.status === "DRAFT";
  const isApproved = order.status === "APPROVED";
  const statusConfig = STATUS_LABELS[order.status];

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/inventory/orders">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{order.orderNumber}</h2>
              {statusConfig && <Badge className={`text-xs ${statusConfig.color}`}>{statusConfig.label}</Badge>}
            </div>
            <p className="text-sm text-text-2">
              {order.supplier?.name ?? "No supplier"} &rarr; {order.outlet.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/inventory/orders")} disabled={saving}>
            Back
          </Button>
          {(isDraft || isApproved) && (
            <Button onClick={() => saveOrder(false)} disabled={saving} className="bg-ink hover:bg-ink-hover">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save Changes
            </Button>
          )}
          {isDraft && (
            <Button onClick={() => saveOrder(true)} disabled={saving} className="bg-ink text-on-ink hover:bg-ink-hover">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Confirm Request
            </Button>
          )}
          {isApproved && order.supplier?.phone && (
            <a href={buildWhatsAppUrl()} target="_blank" rel="noopener noreferrer">
              <Button className="bg-ink text-on-ink hover:bg-ink-hover">
                <MessageCircle className="mr-1.5 h-4 w-4" />
                WhatsApp Supplier
              </Button>
            </a>
          )}
          {isApproved && (
            <Button onClick={markAsSent} disabled={saving} className="bg-ink text-on-ink hover:bg-ink-hover">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              Mark as Sent
            </Button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Deposit requirement banner — shown when supplier requires upfront deposit */}
        {order.supplier?.depositPercent != null && order.supplier.depositPercent > 0 && (
          <div className="rounded-lg border border-line bg-warn-soft p-3">
            <div className="flex items-start gap-2">
              <span className="text-lg">💰</span>
              <div className="flex-1 text-sm">
                <p className="font-semibold text-warn-text">
                  {order.supplier.name} requires {order.supplier.depositPercent}% deposit upfront
                </p>
                <p className="mt-0.5 text-xs text-warn-text">
                  Deposit: <span className="font-mono font-medium">RM {(order.totalAmount * order.supplier.depositPercent / 100).toFixed(2)}</span>
                  {" · "}
                  Balance: <span className="font-mono font-medium">RM {(order.totalAmount * (100 - order.supplier.depositPercent) / 100).toFixed(2)}</span>
                  {order.supplier.depositTermsDays ? ` (due ${order.supplier.depositTermsDays}d after deposit)` : ""}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Delivery Date */}
        <div className="rounded-lg border bg-surface p-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-2">
            <Truck className="h-3.5 w-3.5" /> Delivery date
          </label>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="max-w-xs"
            disabled={!isDraft && !isApproved}
          />
        </div>

        {/* Order Items */}
        <div className="rounded-lg border bg-surface">
          <div className="border-b px-4 py-3">
            <p className="text-xs font-semibold text-text-2 uppercase">Order items</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-sunken text-xs">
                <th className="px-4 py-2 text-left font-medium text-text-2">Product</th>
                <th className="px-4 py-2 text-left font-medium text-text-2">Package</th>
                <th className="px-4 py-2 text-right font-medium text-text-2 w-24">Qty</th>
                <th className="px-4 py-2 text-right font-medium text-text-2 w-28">Unit price</th>
                <th className="px-4 py-2 text-right font-medium text-text-2 w-28">Total</th>
                {(isDraft || isApproved) && <th className="px-4 py-2 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {editItems.map((item, idx) => {
                if (item.removed) {
                  return (
                    <tr key={item.id} className="border-b border-line bg-danger-soft">
                      <td className="px-4 py-2.5 text-text-3 line-through" colSpan={5}>
                        {item.product}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, removed: false } : p))
                            )
                          }
                          className="text-info-text hover:text-info-text"
                          title="Undo"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                }
                const lineTotal = (parseFloat(item.qtyStr) || 0) * (parseFloat(item.priceStr) || 0);
                return (
                  <tr key={item.id} className="border-b border-line">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-text">{item.product}</p>
                      <p className="text-[10px] text-text-3">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-text-2 text-xs">{item.packageLabel}</td>
                    <td className="px-4 py-2.5">
                      {isDraft || isApproved ? (
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="w-full rounded border border-line px-2 py-1.5 text-right text-sm focus:border-ink focus:outline-none"
                          value={item.qtyStr}
                          onChange={(e) =>
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, qtyStr: e.target.value } : p))
                            )
                          }
                        />
                      ) : (
                        <p className="text-right text-sm text-text">{item.qtyStr}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isDraft || isApproved ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full rounded border border-line px-2 py-1.5 text-right text-sm focus:border-ink focus:outline-none"
                          value={item.priceStr}
                          onChange={(e) =>
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, priceStr: e.target.value } : p))
                            )
                          }
                        />
                      ) : (
                        <p className="text-right text-sm text-text">{item.priceStr}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-text">
                      RM {lineTotal.toFixed(2)}
                    </td>
                    {(isDraft || isApproved) && (
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, removed: true } : p))
                            )
                          }
                          className="text-danger-text hover:text-danger-text"
                          title="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line bg-sunken">
                <td colSpan={isDraft || isApproved ? 4 : 4} className="px-4 py-2.5 text-right font-semibold text-text-2">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-text">
                  RM {total.toFixed(2)}
                </td>
                {(isDraft || isApproved) && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
