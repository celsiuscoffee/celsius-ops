"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Loader2,
  Truck,
  CheckCircle2,
  Pencil,
  X,
  Plus,
  Trash2,
  Save,
} from "lucide-react";

type OrderItem = {
  id: string;
  productId: string;
  product: { name: string; sku: string };
  productPackage: { label: string } | null;
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
  supplier: { id: string; name: string } | null;
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

export default function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
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
            packageLabel: i.productPackage?.label ?? "pcs",
            qtyStr: String(Number(i.quantity)),
            priceStr: Number(i.unitPrice).toFixed(2),
            removed: false,
          }))
        );
        setDeliveryDate(data.deliveryDate ? data.deliveryDate.split("T")[0] : "");
        setNotes(data.notes ?? "");
      })
      .catch(() => setError("Order not found"))
      .finally(() => setLoading(false));
  }, [id]);

  const total = editItems
    .filter((i) => !i.removed)
    .reduce((sum, i) => sum + (parseFloat(i.qtyStr) || 0) * (parseFloat(i.priceStr) || 0), 0);

  const saveOrder = async (andConfirm = false) => {
    if (!order) return;
    setSaving(true);
    try {
      // Build item changes
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
      }

      router.push("/inventory/orders");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-500">{error || "Order not found"}</p>
        <Link href="/inventory/orders" className="mt-2 text-sm text-terracotta hover:underline">
          Back to orders
        </Link>
      </div>
    );
  }

  const isDraft = order.status === "DRAFT";

  return (
    <div className="p-6">
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
              <Pencil className="h-4 w-4 text-gray-400" />
              <h2 className="text-xl font-semibold text-gray-900">{order.orderNumber}</h2>
            </div>
            <p className="text-sm text-gray-500">
              {order.supplier?.name ?? "No supplier"} &rarr; {order.outlet.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/inventory/orders")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => saveOrder(false)} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save Changes
          </Button>
          {isDraft && (
            <Button onClick={() => saveOrder(true)} disabled={saving} className="bg-blue-500 hover:bg-blue-600">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Confirm Request
            </Button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Delivery Date */}
        <div className="rounded-lg border bg-white p-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <Truck className="h-3.5 w-3.5" /> Delivery Date
          </label>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {/* Order Items */}
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <p className="text-xs font-semibold text-gray-700 uppercase">Order Items</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs">
                <th className="px-4 py-2 text-left font-medium text-gray-500">Product</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Package</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500 w-24">Qty</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500 w-28">Unit Price</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500 w-28">Total</th>
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {editItems.map((item, idx) => {
                if (item.removed) {
                  return (
                    <tr key={item.id} className="border-b border-gray-50 bg-red-50/50">
                      <td className="px-4 py-2.5 text-gray-400 line-through" colSpan={5}>
                        {item.product}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, removed: false } : p))
                            )
                          }
                          className="text-blue-500 hover:text-blue-700"
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
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{item.product}</p>
                      <p className="text-[10px] text-gray-400">{item.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{item.packageLabel}</td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-right text-sm focus:border-terracotta focus:outline-none"
                        value={item.qtyStr}
                        onChange={(e) =>
                          setEditItems((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, qtyStr: e.target.value } : p))
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-right text-sm focus:border-terracotta focus:outline-none"
                        value={item.priceStr}
                        onChange={(e) =>
                          setEditItems((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, priceStr: e.target.value } : p))
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                      RM {lineTotal.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() =>
                          setEditItems((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, removed: true } : p))
                          )
                        }
                        className="text-red-400 hover:text-red-600"
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={4} className="px-4 py-2.5 text-right font-semibold text-gray-700">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                  RM {total.toFixed(2)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
