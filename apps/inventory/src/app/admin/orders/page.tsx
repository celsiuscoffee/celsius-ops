"use client";

import { useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  ShoppingCart,
  MessageCircle,
  Truck,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Package,
  AlertTriangle,
  Plus,
  Trash2,
  Send,
  Ban,
  ThumbsUp,
} from "lucide-react";

type OrderItem = {
  id: string;
  product: string;
  sku: string;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

type Order = {
  id: string;
  orderNumber: string;
  branch: string;
  branchCode: string;
  supplier: string;
  supplierPhone: string;
  status: string;
  totalAmount: number;
  notes: string | null;
  deliveryDate: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  items: OrderItem[];
  receivingCount: number;
};

type SupplierProduct = {
  id: string;
  name: string;
  sku: string;
  packageId: string | null;
  packageLabel: string;
  price: number;
};

type SupplierOption = {
  id: string;
  name: string;
  phone: string;
  products: SupplierProduct[];
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
};

type CartItem = {
  productId: string;
  productPackageId: string | null;
  name: string;
  sku: string;
  packageLabel: string;
  quantity: number;
  unitPrice: number;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "bg-gray-400", icon: FileText },
  PENDING_APPROVAL: { label: "Pending Approval", color: "bg-amber-500", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-blue-500", icon: CheckCircle2 },
  SENT: { label: "Sent", color: "bg-green-500", icon: MessageCircle },
  AWAITING_DELIVERY: { label: "Awaiting Delivery", color: "bg-purple-500", icon: Truck },
  PARTIALLY_RECEIVED: { label: "Partially Received", color: "bg-amber-600", icon: AlertTriangle },
  COMPLETED: { label: "Completed", color: "bg-gray-500", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "bg-red-500", icon: AlertTriangle },
};

// Valid status transitions
const NEXT_ACTIONS: Record<string, { status: string; label: string; icon: typeof Clock; color: string }[]> = {
  DRAFT: [
    { status: "PENDING_APPROVAL", label: "Submit for Approval", icon: Send, color: "bg-amber-500 hover:bg-amber-600" },
    { status: "CANCELLED", label: "Cancel", icon: Ban, color: "bg-red-500 hover:bg-red-600" },
  ],
  PENDING_APPROVAL: [
    { status: "APPROVED", label: "Approve", icon: ThumbsUp, color: "bg-blue-500 hover:bg-blue-600" },
    { status: "CANCELLED", label: "Reject", icon: Ban, color: "bg-red-500 hover:bg-red-600" },
  ],
  APPROVED: [
    { status: "SENT", label: "Mark as Sent", icon: Send, color: "bg-green-500 hover:bg-green-600" },
  ],
  SENT: [
    { status: "AWAITING_DELIVERY", label: "Awaiting Delivery", icon: Truck, color: "bg-purple-500 hover:bg-purple-600" },
  ],
  AWAITING_DELIVERY: [],
  PARTIALLY_RECEIVED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create order state
  const [showCreate, setShowCreate] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOrders = () => {
    fetch("/api/orders")
      .then((res) => res.json())
      .then((data) => { setOrders(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadOrders(); }, []);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  const addToCart = (p: SupplierProduct) => {
    if (cart.find((c) => c.productId === p.id && c.productPackageId === p.packageId)) return;
    setCart([...cart, {
      productId: p.id,
      productPackageId: p.packageId,
      name: p.name,
      sku: p.sku,
      packageLabel: p.packageLabel,
      quantity: 1,
      unitPrice: p.price,
    }]);
  };

  const updateQty = (idx: number, qty: number) => {
    if (qty < 1) return;
    setCart(cart.map((c, i) => i === idx ? { ...c, quantity: qty } : c));
  };

  const removeFromCart = (idx: number) => {
    setCart(cart.filter((_, i) => i !== idx));
  };

  const cartTotal = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);

  const openCreateDialog = () => {
    // Load suppliers + branches for the form
    Promise.all([
      fetch("/api/suppliers/products").then((r) => r.json()),
      fetch("/api/branches").then((r) => r.json()),
    ]).then(([s, b]) => {
      setSuppliers(s);
      setBranches(b);
      setSelectedSupplierId("");
      setSelectedBranchId(b[0]?.id ?? "");
      setCart([]);
      setOrderNotes("");
      setDeliveryDate("");
      setShowCreate(true);
    });
  };

  const submitOrder = async () => {
    if (!selectedBranchId || !selectedSupplierId || cart.length === 0) return;
    setSaving(true);
    try {
      await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          supplierId: selectedSupplierId,
          notes: orderNotes,
          deliveryDate: deliveryDate || null,
          items: cart.map((c) => ({
            productId: c.productId,
            productPackageId: c.productPackageId,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
          })),
        }),
      });
      setShowCreate(false);
      loadOrders();
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId);
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const buildWhatsAppUrl = (order: Order) => {
    const items = order.items.map((i) => `• ${i.product} (${i.package}) × ${i.quantity}`).join("\n");
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nBranch: ${order.branch}\n${order.deliveryDate ? `Delivery: ${order.deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: RM ${order.totalAmount.toFixed(2)}\n\n${order.notes ? `Notes: ${order.notes}\n\n` : ""}Thank you!`;
    const phone = order.supplierPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  const statuses = ["All", ...Object.keys(STATUS_CONFIG)];

  const filtered = orders.filter((o) => {
    const matchSearch =
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.supplier.toLowerCase().includes(search.toLowerCase()) ||
      o.branch.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalValue = filtered.reduce((a, o) => a + o.totalAmount, 0);
  const pendingCount = orders.filter((o) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "AWAITING_DELIVERY"].includes(o.status)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Purchase Orders</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {orders.length} orders &middot; {pendingCount} active
          </p>
        </div>
        <Button className="bg-terracotta hover:bg-terracotta-dark" onClick={openCreateDialog}>
          <Plus className="mr-1.5 h-4 w-4" />Create Order
        </Button>
      </div>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-4 gap-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-xl font-bold text-gray-900">{orders.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Active / In Progress</p>
          <p className="text-xl font-bold text-terracotta">{pendingCount}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Completed</p>
          <p className="text-xl font-bold text-green-600">{orders.filter((o) => o.status === "COMPLETED").length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Value</p>
          <p className="text-xl font-bold text-gray-900">RM {totalValue.toFixed(2)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by PO#, supplier, or branch..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => {
            const config = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${statusFilter === s ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >
                {s === "All" ? "All" : config?.label ?? s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">PO Number</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Branch</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Delivery</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {orders.length === 0
                      ? "No orders yet. Click 'Create Order' to get started."
                      : "No orders match your filter."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((order) => {
              const config = STATUS_CONFIG[order.status] ?? { label: order.status, color: "bg-gray-400", icon: Clock };
              const actions = NEXT_ACTIONS[order.status] ?? [];

              return (
                <Fragment key={order.id}>
                  <tr
                    className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  >
                    <td className="px-3 py-3">
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === order.id ? "rotate-180" : ""}`} />
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{order.orderNumber}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{order.branch}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{order.supplier}</span>
                        {order.supplierPhone && (
                          <a
                            href={buildWhatsAppUrl(order)}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="text-green-600 hover:text-green-700"
                            title="Send via WhatsApp"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] ${config.color}`}>{config.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      RM {order.totalAmount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="flex items-center gap-1 text-xs">
                        <Package className="h-3 w-3" />
                        {order.items.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {order.deliveryDate ?? "—"}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {actions.map((a) => (
                          <button
                            key={a.status}
                            onClick={() => updateStatus(order.id, a.status)}
                            disabled={updatingId === order.id}
                            className={`rounded-md px-2 py-1 text-[10px] font-medium text-white ${a.color} disabled:opacity-50`}
                            title={a.label}
                          >
                            {updatingId === order.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              a.label
                            )}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {expandedId === order.id && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-8 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase">Order Items</p>
                          <div className="flex gap-2 text-xs text-gray-400">
                            <span>Created by: {order.createdBy}</span>
                            {order.approvedBy && <span>&middot; Approved by: {order.approvedBy}</span>}
                            {order.sentAt && <span>&middot; Sent: {new Date(order.sentAt).toLocaleDateString("en-MY")}</span>}
                          </div>
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="pb-1 text-left font-medium">Product</th>
                              <th className="pb-1 text-left font-medium">SKU</th>
                              <th className="pb-1 text-left font-medium">Package</th>
                              <th className="pb-1 text-right font-medium">Qty</th>
                              <th className="pb-1 text-right font-medium">Unit Price</th>
                              <th className="pb-1 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.items.map((item) => (
                              <tr key={item.id} className="border-t border-gray-200/50">
                                <td className="py-1.5 text-gray-700">{item.product}</td>
                                <td className="py-1.5"><code className="text-gray-500">{item.sku}</code></td>
                                <td className="py-1.5 text-gray-500">{item.package}</td>
                                <td className="py-1.5 text-right text-gray-700">{item.quantity}</td>
                                <td className="py-1.5 text-right text-gray-600">RM {item.unitPrice.toFixed(2)}</td>
                                <td className="py-1.5 text-right text-gray-900 font-medium">RM {item.totalPrice.toFixed(2)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-gray-300">
                              <td colSpan={5} className="py-1.5 font-semibold text-gray-700">Total</td>
                              <td className="py-1.5 text-right font-semibold text-gray-900">RM {order.totalAmount.toFixed(2)}</td>
                            </tr>
                          </tbody>
                        </table>
                        {order.notes && (
                          <p className="mt-2 text-xs text-gray-500">Notes: {order.notes}</p>
                        )}
                        {order.receivingCount > 0 && (
                          <p className="mt-2 text-xs text-green-600">{order.receivingCount} receiving record(s) linked</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Order Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Branch + Supplier selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Branch</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Supplier</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => { setSelectedSupplierId(e.target.value); setCart([]); }}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.products.length} products)</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Delivery date + notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Expected Delivery</label>
                <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input placeholder="Optional notes..." value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
              </div>
            </div>

            {/* Product picker */}
            {selectedSupplier && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Add Products</label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
                  {selectedSupplier.products.map((p) => {
                    const inCart = cart.some((c) => c.productId === p.id && c.productPackageId === p.packageId);
                    return (
                      <button
                        key={`${p.id}-${p.packageId}`}
                        onClick={() => addToCart(p)}
                        disabled={inCart}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0 ${inCart ? "opacity-40" : ""}`}
                      >
                        <span className="font-medium text-gray-700">{p.name}</span>
                        <span className="flex items-center gap-2 text-gray-500">
                          <span>{p.packageLabel}</span>
                          <span className="font-medium">RM {p.price.toFixed(2)}</span>
                          {!inCart && <Plus className="h-3 w-3 text-terracotta" />}
                        </span>
                      </button>
                    );
                  })}
                  {selectedSupplier.products.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-gray-400">No products linked to this supplier</p>
                  )}
                </div>
              </div>
            )}

            {/* Cart */}
            {cart.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Order Items ({cart.length})</label>
                <div className="rounded-md border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-gray-50 text-gray-500">
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-left font-medium">Unit</th>
                        <th className="px-3 py-2 text-center font-medium w-24">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Price</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((c, idx) => (
                        <tr key={idx} className="border-b border-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-700">{c.name}</td>
                          <td className="px-3 py-2 text-gray-500">{c.packageLabel}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => updateQty(idx, c.quantity - 1)} className="rounded border px-1.5 py-0.5 text-gray-500 hover:bg-gray-100">−</button>
                              <input
                                type="number"
                                value={c.quantity}
                                onChange={(e) => updateQty(idx, parseInt(e.target.value) || 1)}
                                className="w-12 rounded border px-1 py-0.5 text-center"
                                min={1}
                              />
                              <button onClick={() => updateQty(idx, c.quantity + 1)} className="rounded border px-1.5 py-0.5 text-gray-500 hover:bg-gray-100">+</button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">RM {c.unitPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">RM {(c.quantity * c.unitPrice).toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => removeFromCart(idx)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-3 py-2 font-semibold text-gray-700">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">RM {cartTotal.toFixed(2)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={submitOrder}
              disabled={saving || !selectedSupplierId || !selectedBranchId || cart.length === 0}
              className="bg-terracotta hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-1.5 h-4 w-4" />}
              Create Order (RM {cartTotal.toFixed(2)})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
