"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  ShoppingCart,
  MessageCircle,
  Loader2,
  Package,
  AlertTriangle,
  Plus,
  Minus,
  Trash2,
  FileText,
  RotateCcw,
  ArrowLeft,
  Truck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type SupplierProduct = {
  id: string;
  name: string;
  sku: string;
  packageId: string | null;
  packageLabel: string;
  price: number;
  conversionFactor: number;
};

type SupplierOption = {
  id: string;
  name: string;
  phone: string;
  leadTimeDays: number;
  products: SupplierProduct[];
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
};

type StockLevelItem = {
  productId: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
  currentQty: number;
  parLevel: number;
  reorderPoint: number;
  avgDailyUsage: number;
  daysLeft: number | null;
  suggestedOrderQty: number;
  status: "critical" | "low" | "ok" | "overstocked" | "no_par";
};

type CartItem = {
  productId: string;
  productPackageId: string | null;
  name: string;
  sku: string;
  supplier: string;
  supplierId: string;
  supplierPhone: string;
  packageLabel: string;
  quantity: number;
  unitPrice: number;
};

type OrderItem = {
  id: string;
  product: string;
  sku: string;
  uom: string;
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
  supplier: string;
  supplierPhone: string;
  supplierId: string;
  status: string;
  totalAmount: number;
  items: OrderItem[];
  createdAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDeliveryDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short" });
}

// ── Component ─────────────────────────────────────────────────────────────

export default function CreateOrderPage() {
  const router = useRouter();

  // Data
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [stockLevels, setStockLevels] = useState<StockLevelItem[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loading, setLoading] = useState(true);

  // Order
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [createTab, setCreateTab] = useState<"suggested" | "all" | "reorder">("suggested");
  const [saving, setSaving] = useState(false);

  // WhatsApp dialog
  const [whatsappDialog, setWhatsappDialog] = useState<{
    open: boolean;
    supplier: string;
    supplierId: string;
    message: string;
    phone: string;
    items: CartItem[];
  }>({ open: false, supplier: "", supplierId: "", message: "", phone: "", items: [] });
  const [sending, setSending] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────

  const loadStockLevels = useCallback(async (branchId: string) => {
    if (!branchId) { setStockLevels([]); return; }
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/stock-levels?branchId=${branchId}`);
      if (res.ok) {
        const data = await res.json();
        setStockLevels(data.items || []);
      }
    } catch { /* silently fail */ }
    finally { setLoadingStock(false); }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/suppliers/products").then((r) => r.json()),
      fetch("/api/branches").then((r) => r.json()),
      fetch("/api/orders").then((r) => r.json()),
    ]).then(([s, b, o]) => {
      setSuppliers(s);
      setBranches(b);
      setOrders(o);
      const defaultBranch = b[0]?.id ?? "";
      setSelectedBranchId(defaultBranch);
      if (defaultBranch) loadStockLevels(defaultBranch);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [loadStockLevels]);

  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    setCart([]);
    loadStockLevels(branchId);
  };

  // ── Derived data ────────────────────────────────────────────────────────

  // Needs ordering: critical/low items matched with supplier info
  const needsOrdering = stockLevels
    .filter((i) =>
      (i.status === "critical" || i.status === "low") &&
      (!productSearch ||
        i.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        i.sku.toLowerCase().includes(productSearch.toLowerCase()))
    )
    .map((item) => {
      let supplierMatch: SupplierOption | undefined;
      let productMatch: SupplierProduct | undefined;
      for (const s of suppliers) {
        const p = s.products.find((sp) => sp.id === item.productId);
        if (p) { supplierMatch = s; productMatch = p; break; }
      }
      return { ...item, supplier: supplierMatch, supplierProduct: productMatch };
    })
    .filter((item) => !supplierFilter || item.supplier?.id === supplierFilter)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  // All products grouped by supplier
  const supplierProducts = (productSearch.trim().length >= 2 || supplierFilter)
    ? suppliers
        .filter((s) => s.products.length > 0)
        .filter((s) => !supplierFilter || s.id === supplierFilter)
        .map((s) => ({
          ...s,
          products: productSearch.trim().length >= 2
            ? s.products.filter((p) =>
                p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                p.sku.toLowerCase().includes(productSearch.toLowerCase())
              )
            : s.products,
        }))
        .filter((s) => s.products.length > 0)
    : [];

  // Quick reorder: last order per supplier for the selected branch
  const quickReorders = (() => {
    const branch = branches.find((b) => b.id === selectedBranchId);
    if (!branch) return [];
    const branchOrders = orders.filter((o) => o.branch === branch.name);
    const seen = new Set<string>();
    const result: Order[] = [];
    for (const order of branchOrders) {
      if (!seen.has(order.supplier) && order.items.length > 0) {
        seen.add(order.supplier);
        result.push(order);
      }
    }
    return result;
  })();

  // ── Cart helpers ────────────────────────────────────────────────────────

  const isInCart = (productId: string, supplierId: string) =>
    cart.some((c) => c.productId === productId && c.supplierId === supplierId);

  const addToCart = (item: CartItem) => {
    if (isInCart(item.productId, item.supplierId)) return;
    setCart((prev) => [...prev, item]);
  };

  const updateCartQty = (productId: string, supplierId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.productId === productId && c.supplierId === supplierId
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (productId: string, supplierId: string) => {
    setCart((prev) => prev.filter((c) => !(c.productId === productId && c.supplierId === supplierId)));
  };

  const cartTotal = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);

  // Group cart by supplier
  const cartBySupplier = cart.reduce(
    (acc, item) => {
      if (!acc[item.supplier])
        acc[item.supplier] = { items: [], phone: item.supplierPhone, supplierId: item.supplierId };
      acc[item.supplier].items.push(item);
      return acc;
    },
    {} as Record<string, { items: CartItem[]; phone: string; supplierId: string }>
  );

  // Get expected delivery date for a supplier based on leadTimeDays
  const getDeliveryDate = (supplierId: string): string => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return addDays(supplier?.leadTimeDays ?? 1);
  };

  // Handle quick reorder
  const handleReorder = (order: Order) => {
    const supplier = suppliers.find((s) => s.name === order.supplier);
    if (!supplier) return;
    const newItems: CartItem[] = order.items
      .map((item) => {
        const sp = supplier.products.find((p) => p.name === item.product || p.sku === item.sku);
        if (!sp) return null;
        return {
          productId: sp.id,
          productPackageId: sp.packageId,
          name: item.product,
          sku: item.sku,
          supplier: order.supplier,
          supplierId: supplier.id,
          supplierPhone: order.supplierPhone,
          packageLabel: sp.packageLabel,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        };
      })
      .filter((x): x is CartItem => x !== null);
    setCart((prev) => {
      const existing = new Set(prev.map((c) => `${c.productId}-${c.supplierId}`));
      return [...prev, ...newItems.filter((n) => !existing.has(`${n.productId}-${n.supplierId}`))];
    });
  };

  // ── WhatsApp flow ───────────────────────────────────────────────────────

  const sendViaWhatsApp = (supplier: string) => {
    const group = cartBySupplier[supplier];
    if (!group) return;
    const branch = branches.find((b) => b.id === selectedBranchId);
    const deliveryDate = getDeliveryDate(group.supplierId);
    const today = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" });
    let message = `📋 *Order from Celsius Coffee*\n`;
    message += `Branch: ${branch?.name || "—"}\nDate: ${today}\n\n`;
    group.items.forEach((item, i) => {
      message += `${i + 1}. ${item.name} — ${item.quantity} ${item.packageLabel}\n`;
    });
    message += `\nDelivery: ${formatDeliveryDate(deliveryDate)}`;
    if (orderNotes) message += `\nNotes: ${orderNotes}`;
    message += `\n\nThank you! 🙏`;
    setWhatsappDialog({ open: true, supplier, supplierId: group.supplierId, message, phone: group.phone, items: group.items });
  };

  const openWhatsApp = async () => {
    setSending(true);
    try {
      const group = cartBySupplier[whatsappDialog.supplier];
      if (!group) return;
      const deliveryDate = getDeliveryDate(group.supplierId);

      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranchId,
          supplierId: whatsappDialog.supplierId,
          items: group.items.map((item) => ({
            productId: item.productId,
            productPackageId: item.productPackageId || undefined,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          notes: orderNotes || null,
          deliveryDate,
        }),
      });

      if (orderRes.ok) {
        const order = await orderRes.json();
        await fetch(`/api/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "SENT" }),
        });
      }

      const phone = whatsappDialog.phone.replace(/\+/g, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsappDialog.message)}`, "_blank");

      setCart((prev) => prev.filter((c) => c.supplierId !== whatsappDialog.supplierId));
      setWhatsappDialog({ open: false, supplier: "", supplierId: "", message: "", phone: "", items: [] });

      // If cart is now empty after sending, navigate back
      if (cart.filter((c) => c.supplierId !== whatsappDialog.supplierId).length === 0) {
        router.push("/admin/orders");
      }
    } catch (err) {
      console.error("Failed to create order:", err);
    } finally {
      setSending(false);
    }
  };

  const submitAsDraft = async () => {
    setSaving(true);
    try {
      for (const [, group] of Object.entries(cartBySupplier)) {
        const deliveryDate = getDeliveryDate(group.supplierId);
        await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: selectedBranchId,
            supplierId: group.supplierId,
            notes: orderNotes || null,
            deliveryDate,
            items: group.items.map((c) => ({
              productId: c.productId,
              productPackageId: c.productPackageId,
              quantity: c.quantity,
              unitPrice: c.unitPrice,
            })),
          }),
        });
      }
      router.push("/admin/orders");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/orders">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Smart Order</h2>
            <p className="text-sm text-gray-500">Create purchase orders based on stock levels</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── Left: Product selection ── */}
        <div className="col-span-8">
          {/* Branch + controls */}
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Branch</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Supplier</label>
                <select
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="">All Suppliers</option>
                  {suppliers.filter((s) => s.products.length > 0).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Search Products</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input placeholder="Search by name or SKU..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-9" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input placeholder="Optional notes..." value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
              </div>
            </div>
          </Card>

          {/* Tabs */}
          <div className="mb-4 flex items-center gap-2">
            {([
              { id: "suggested" as const, label: "Needs Ordering", icon: AlertTriangle, count: needsOrdering.length },
              { id: "all" as const, label: "All Products", icon: Package, count: 0 },
              { id: "reorder" as const, label: "Quick Reorder", icon: RotateCcw, count: quickReorders.length },
            ]).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCreateTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    createTab === tab.id ? "bg-terracotta text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${createTab === tab.id ? "bg-white/20" : "bg-red-100 text-red-600"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Loading */}
          {loadingStock && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-terracotta" />
              <span className="ml-2 text-sm text-gray-500">Loading stock levels...</span>
            </div>
          )}

          {/* ── Needs Ordering tab ── */}
          {createTab === "suggested" && !loadingStock && (
            <div className="space-y-2">
              {needsOrdering.length === 0 ? (
                <Card className="py-12 text-center">
                  <Package className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-400">All stock levels are healthy for this branch</p>
                </Card>
              ) : (
                needsOrdering.map((item) => {
                  const pct = item.parLevel > 0 ? Math.min(100, Math.round((item.currentQty / item.parLevel) * 100)) : 0;
                  const barColor = item.status === "critical" ? "bg-red-500" : "bg-amber-500";
                  const inCartAlready = item.supplier && isInCart(item.productId, item.supplier.id);
                  const cartItem = item.supplier ? cart.find((c) => c.productId === item.productId && c.supplierId === item.supplier!.id) : null;
                  const pkgQty = item.supplierProduct ? Math.max(1, Math.ceil((item.suggestedOrderQty || 1) / (item.supplierProduct.conversionFactor || 1))) : 1;

                  return (
                    <Card key={item.productId} className={`px-4 py-3 ${item.status === "critical" ? "border-red-200 bg-red-50/30" : "border-amber-200 bg-amber-50/30"}`}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                            <Badge className={`text-[10px] ${(item.daysLeft ?? 0) < 0.1 ? "bg-red-600" : (item.daysLeft ?? 0) < 1 ? "bg-red-500" : "bg-amber-500"}`}>
                              {(item.daysLeft ?? 0) < 0.1 ? "OUT" : `${(item.daysLeft ?? 0).toFixed(1)}d left`}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {item.sku} &middot; {item.category}
                            {item.supplier && item.supplierProduct && (
                              <> &middot; {item.supplier.name} &middot; RM {item.supplierProduct.price.toFixed(2)}/{item.supplierProduct.packageLabel}</>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Stock bar */}
                          <div className="w-32">
                            <div className="h-2 rounded-full bg-gray-100">
                              <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className="mt-0.5 text-[10px] text-gray-400 text-right">
                              {item.currentQty.toLocaleString()}/{item.parLevel.toLocaleString()} {item.baseUom}
                            </p>
                          </div>

                          {/* Cart controls */}
                          {inCartAlready && cartItem ? (
                            <div className="flex items-center gap-2">
                              <button onClick={() => updateCartQty(item.productId, item.supplier!.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"><Minus className="h-3.5 w-3.5" /></button>
                              <span className="min-w-[2rem] text-center text-sm font-bold">{cartItem.quantity}</span>
                              <button onClick={() => updateCartQty(item.productId, item.supplier!.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark hover:bg-terracotta/20"><Plus className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : item.supplier && item.supplierProduct ? (
                            <Button size="sm" className={`h-8 text-xs ${item.status === "critical" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}
                              onClick={() => addToCart({
                                productId: item.productId, productPackageId: item.supplierProduct!.packageId,
                                name: item.name, sku: item.sku, supplier: item.supplier!.name,
                                supplierId: item.supplier!.id, supplierPhone: item.supplier!.phone,
                                packageLabel: item.supplierProduct!.packageLabel,
                                quantity: pkgQty, unitPrice: item.supplierProduct!.price,
                              })}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />Add {pkgQty} {item.supplierProduct.packageLabel}
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-400">No supplier linked</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          )}

          {/* ── All Products tab ── */}
          {createTab === "all" && !loadingStock && (
            <div className="space-y-4">
              {supplierProducts.length === 0 ? (
                <Card className="py-12 text-center">
                  <Search className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-400">
                    {(productSearch && productSearch.trim().length >= 2) || supplierFilter
                      ? "No products match your filter"
                      : "Select a supplier or type at least 2 characters to search"}
                  </p>
                  <p className="mt-1 text-xs text-gray-300">
                    {!supplierFilter && (!productSearch || productSearch.trim().length < 2)
                      ? `${suppliers.reduce((acc, s) => acc + s.products.length, 0)} products from ${suppliers.length} suppliers available`
                      : "Try a different supplier or keyword"}
                  </p>
                </Card>
              ) : (
                supplierProducts.map((supplier) => (
                  <div key={supplier.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-700">{supplier.name}</h3>
                      <Badge className="bg-terracotta/10 text-xs text-terracotta-dark">{supplier.products.length}</Badge>
                    </div>
                    <div className="space-y-1.5">
                      {supplier.products.map((product) => {
                        const inCart = isInCart(product.id, supplier.id);
                        const cartItem = cart.find((c) => c.productId === product.id && c.supplierId === supplier.id);
                        return (
                          <Card key={`${supplier.id}-${product.id}`} className="flex items-center justify-between px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">{product.name}</p>
                              <p className="text-xs text-gray-500">{product.sku} &middot; {product.packageLabel} &middot; RM {product.price.toFixed(2)}</p>
                            </div>
                            {inCart ? (
                              <div className="flex items-center gap-2">
                                <button onClick={() => updateCartQty(product.id, supplier.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"><Minus className="h-3.5 w-3.5" /></button>
                                <span className="min-w-[2rem] text-center text-sm font-bold">{cartItem?.quantity}</span>
                                <button onClick={() => updateCartQty(product.id, supplier.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark hover:bg-terracotta/20"><Plus className="h-3.5 w-3.5" /></button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="h-8 text-xs"
                                onClick={() => addToCart({
                                  productId: product.id, productPackageId: product.packageId,
                                  name: product.name, sku: product.sku, supplier: supplier.name,
                                  supplierId: supplier.id, supplierPhone: supplier.phone,
                                  packageLabel: product.packageLabel, quantity: 1, unitPrice: product.price,
                                })}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />Add
                              </Button>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Quick Reorder tab ── */}
          {createTab === "reorder" && (
            <div className="space-y-2">
              {quickReorders.length === 0 ? (
                <Card className="py-12 text-center">
                  <RotateCcw className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-400">No previous orders for this branch</p>
                </Card>
              ) : (
                quickReorders.map((order) => (
                  <Card key={order.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{order.supplier}</p>
                        <p className="text-xs text-gray-400">
                          {order.orderNumber} &middot; {new Date(order.createdAt).toLocaleDateString("en-MY")} &middot; RM {order.totalAmount.toFixed(2)}
                        </p>
                      </div>
                      <Button size="sm" className="h-8 bg-green-600 text-xs hover:bg-green-700" onClick={() => handleReorder(order)}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />Reorder
                      </Button>
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {order.items.map((item, i) => (
                        <p key={i} className="text-xs text-gray-500">{item.quantity} {item.uom || item.package} — {item.product}</p>
                      ))}
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Right: Cart sidebar ── */}
        <div className="col-span-4">
          <div className="sticky top-6">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <ShoppingCart className="h-4 w-4" />Order Cart
                </span>
                {cart.length > 0 && (
                  <Badge className="bg-terracotta">{cart.length}</Badge>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-8 text-center">
                  <ShoppingCart className="mx-auto h-8 w-8 text-gray-200" />
                  <p className="mt-2 text-xs text-gray-400">Add products to get started</p>
                </div>
              ) : (
                <>
                  {/* Cart items grouped by supplier */}
                  <div className="max-h-[50vh] overflow-y-auto space-y-4">
                    {Object.entries(cartBySupplier).map(([supplier, group]) => {
                      const supplierData = suppliers.find((s) => s.id === group.supplierId);
                      const deliveryDate = getDeliveryDate(group.supplierId);
                      const supplierTotal = group.items.reduce((s, c) => s + c.quantity * c.unitPrice, 0);

                      return (
                        <div key={supplier} className="rounded-lg border border-gray-100 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-semibold text-gray-700">{supplier}</p>
                            <p className="text-xs font-bold text-gray-900">RM {supplierTotal.toFixed(2)}</p>
                          </div>

                          {/* Expected delivery */}
                          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1.5">
                            <Truck className="h-3 w-3 text-blue-500" />
                            <span className="text-[11px] text-blue-700">
                              Expected delivery: <strong>{formatDeliveryDate(deliveryDate)}</strong>
                              {supplierData && <span className="text-blue-500"> ({supplierData.leadTimeDays}d lead time)</span>}
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {group.items.map((item) => (
                              <div key={`${item.productId}-${item.supplierId}`} className="flex items-center justify-between text-xs">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-gray-700">{item.name}</p>
                                  <p className="text-[10px] text-gray-400">{item.quantity} × RM {item.unitPrice.toFixed(2)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">RM {(item.quantity * item.unitPrice).toFixed(2)}</span>
                                  <button onClick={() => removeFromCart(item.productId, item.supplierId)} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Total */}
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                    <span className="text-sm font-semibold text-gray-700">Total</span>
                    <span className="text-lg font-bold text-gray-900">RM {cartTotal.toFixed(2)}</span>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 space-y-2">
                    <Button variant="outline" className="w-full h-10 text-sm" onClick={submitAsDraft} disabled={saving}>
                      {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
                      Save as Draft
                    </Button>
                    {Object.entries(cartBySupplier).map(([supplier, group]) => (
                      <Button key={supplier} className="w-full h-10 bg-green-600 hover:bg-green-700 text-sm" onClick={() => sendViaWhatsApp(supplier)}>
                        <MessageCircle className="mr-1.5 h-4 w-4" />
                        Send to {supplier} ({group.items.length})
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* WhatsApp preview dialog */}
      <Dialog open={whatsappDialog.open} onOpenChange={(open) => setWhatsappDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Order to {whatsappDialog.supplier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="rounded-lg bg-green-50 p-3">
              <pre className="whitespace-pre-wrap text-xs text-gray-700">{whatsappDialog.message}</pre>
            </div>
            <Button className="w-full bg-green-600 hover:bg-green-700" onClick={openWhatsApp} disabled={sending}>
              {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-1.5 h-4 w-4" />}
              {sending ? "Creating order..." : "Open WhatsApp"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
