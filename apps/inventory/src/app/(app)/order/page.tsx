"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShoppingCart,
  Plus,
  Minus,
  Search,
  MessageCircle,
  Clock,
  History,
  RotateCcw,
  Loader2,
  Package,
  AlertTriangle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type ProductPackage = {
  id: string;
  name: string;
  label: string;
  uom: string;
  conversion: number;
  conversionFactor: number;
  isDefault: boolean;
};

type ProductSupplier = {
  name: string;
  price: number;
  uom: string;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
  packages: ProductPackage[];
  suppliers: ProductSupplier[];
};

type SupplierProduct = {
  id: string;
  name: string;
  sku: string;
  packageId: string | null;
  packageLabel: string;
  price: number;
  conversionFactor: number;
};

type Supplier = {
  id: string;
  name: string;
  phone: string;
  products: SupplierProduct[];
};

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
  supplier: string;
  supplierPhone: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
};

type SessionUser = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
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
  daysLeft: number;
  suggestedOrderQty: number;
  status: "critical" | "low" | "ok" | "noPar";
};

type StockLevelsData = {
  summary: { critical: number; low: number; ok: number; noPar: number; total: number };
  items: StockLevelItem[];
};

type CartItem = {
  productId: string;
  name: string;
  sku: string;
  supplier: string;
  supplierId: string;
  supplierPhone: string;
  qty: number;
  uom: string;
  unitPrice: number;
  packageId: string | null;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function OrderPage() {
  const [activeTab, setActiveTab] = useState<"suggested" | "history" | "reorder">("suggested");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [whatsappDialog, setWhatsappDialog] = useState<{
    open: boolean;
    supplier: string;
    supplierId: string;
    message: string;
    phone: string;
  }>({ open: false, supplier: "", supplierId: "", message: "", phone: "" });

  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [stockLevels, setStockLevels] = useState<StockLevelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showAllNeeds, setShowAllNeeds] = useState(false);

  // ── Fetch data on mount ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [suppliersRes, ordersRes, meRes] = await Promise.all([
        fetch("/api/suppliers/products"),
        fetch("/api/orders"),
        fetch("/api/auth/me"),
      ]);

      if (suppliersRes.ok) {
        const suppData: Supplier[] = await suppliersRes.json();
        setSuppliers(suppData);
      }
      if (ordersRes.ok) {
        const ordData: Order[] = await ordersRes.json();
        setOrders(ordData);
      }
      let outletId: string | null = null;
      if (meRes.ok) {
        const meData: SessionUser = await meRes.json();
        setUser(meData);
        outletId = meData.outletId;
      }

      // Fetch stock levels
      if (outletId) {
        try {
          const slRes = await fetch(`/api/stock-levels?outletId=${outletId}`);
          if (slRes.ok) {
            const slData: StockLevelsData = await slRes.json();
            setStockLevels(slData);
          }
        } catch {
          // Stock levels are optional — fail silently
        }
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Cart helpers ─────────────────────────────────────────────────────

  const addToCart = (item: CartItem) => {
    setCart((prev) => {
      const key = `${item.productId}-${item.supplierId}`;
      const existing = prev.find((c) => `${c.productId}-${c.supplierId}` === key);
      if (existing) return prev;
      return [...prev, item];
    });
  };

  const updateCartQty = (productId: string, supplierId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.productId === productId && c.supplierId === supplierId
            ? { ...c, qty: Math.max(0, c.qty + delta) }
            : c
        )
        .filter((c) => c.qty > 0)
    );
  };

  const isInCart = (productId: string, supplierId: string) =>
    cart.some((c) => c.productId === productId && c.supplierId === supplierId);

  const cartTotal = cart.reduce((acc, c) => acc + c.qty * c.unitPrice, 0);

  // Group cart by supplier for WhatsApp sending
  const cartBySupplier = cart.reduce(
    (acc, item) => {
      if (!acc[item.supplier])
        acc[item.supplier] = { items: [], phone: item.supplierPhone, supplierId: item.supplierId };
      acc[item.supplier].items.push(item);
      return acc;
    },
    {} as Record<string, { items: CartItem[]; phone: string; supplierId: string }>
  );

  // ── WhatsApp flow ────────────────────────────────────────────────────

  const sendViaWhatsApp = (supplier: string) => {
    const group = cartBySupplier[supplier];
    if (!group) return;

    const today = new Date().toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    let message = `📋 *Order from Celsius Coffee*\n`;
    message += `Date: ${today}\n\n`;

    group.items.forEach((item, i) => {
      message += `${i + 1}. ${item.name} — ${item.qty} ${item.uom}\n`;
    });

    message += `\nDelivery: ${tomorrow}`;
    message += `\n\nThank you! 🙏`;

    setWhatsappDialog({
      open: true,
      supplier,
      supplierId: group.supplierId,
      message,
      phone: group.phone,
    });
  };

  const openWhatsApp = async () => {
    setSending(true);
    try {
      const group = cartBySupplier[whatsappDialog.supplier];
      if (!group) return;

      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      // Create order via API
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: user?.outletId,
          supplierId: whatsappDialog.supplierId,
          items: group.items.map((item) => ({
            productId: item.productId,
            productPackageId: item.packageId || undefined,
            quantity: item.qty,
            unitPrice: item.unitPrice,
          })),
          notes: null,
          deliveryDate: tomorrow,
        }),
      });

      if (!orderRes.ok) {
        alert("Failed to create order. Please try again.");
        setSending(false);
        return;
      }

      const order = await orderRes.json();

      // Update status to SENT
      await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SENT" }),
      });

      // Open WhatsApp
      const phone = whatsappDialog.phone.replace(/\+/g, "");
      const encoded = encodeURIComponent(whatsappDialog.message);
      window.open(`https://wa.me/${phone}?text=${encoded}`, "_blank");

      // Remove sent items from cart
      setCart((prev) => prev.filter((c) => c.supplierId !== whatsappDialog.supplierId));
      setWhatsappDialog({ open: false, supplier: "", supplierId: "", message: "", phone: "" });

      // Refresh orders
      const refreshRes = await fetch("/api/orders");
      if (refreshRes.ok) {
        setOrders(await refreshRes.json());
      }
    } catch (err) {
      console.error("Failed to create order:", err);
    } finally {
      setSending(false);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────

  // Products with supplier pricing, grouped by supplier
  // Only show when searching (don't render 1000 products at once)
  const supplierProducts = search.trim().length >= 2
    ? suppliers
        .filter((s) => s.products.length > 0)
        .map((s) => ({
          ...s,
          products: s.products.filter(
            (p) =>
              p.name.toLowerCase().includes(search.toLowerCase()) ||
              p.sku.toLowerCase().includes(search.toLowerCase())
          ),
        }))
        .filter((s) => s.products.length > 0)
    : [];

  // Products that need ordering (critical/low stock) matched with supplier info
  const needsOrdering = (() => {
    if (!stockLevels) return [];
    const lowItems = stockLevels.items.filter(
      (i) =>
        (i.status === "critical" || i.status === "low") &&
        (!search ||
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          i.sku.toLowerCase().includes(search.toLowerCase()))
    );

    return lowItems
      .map((item) => {
        // Find the supplier and product info for this item
        let supplierMatch: Supplier | undefined;
        let productMatch: SupplierProduct | undefined;
        for (const s of suppliers) {
          const p = s.products.find((sp) => sp.id === item.productId);
          if (p) {
            supplierMatch = s;
            productMatch = p;
            break;
          }
        }
        return { ...item, supplier: supplierMatch, supplierProduct: productMatch };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  })();

  // Last order per supplier for quick reorder
  const quickReorders = (() => {
    const seen = new Set<string>();
    const result: Order[] = [];
    for (const order of orders) {
      if (!seen.has(order.supplier) && order.items.length > 0) {
        seen.add(order.supplier);
        result.push(order);
      }
    }
    return result;
  })();

  // Reorder: re-populate cart from a past order
  const handleReorder = (order: Order) => {
    // Find supplier
    const supplier = suppliers.find((s) => s.name === order.supplier);
    if (!supplier) return;

    const newItems: CartItem[] = order.items
      .map((item) => {
        // Find matching supplier product for productId lookup
        const sp = supplier.products.find(
          (p) => p.name === item.product || p.sku === item.sku
        );
        if (!sp) return null;
        return {
          productId: sp.id,
          name: item.product,
          sku: item.sku,
          supplier: order.supplier,
          supplierId: supplier.id,
          supplierPhone: order.supplierPhone,
          qty: item.quantity,
          uom: item.package || supplier.products.find((p) => p.id === sp.id)?.packageLabel || "",
          unitPrice: item.unitPrice,
          packageId: sp.packageId,
        };
      })
      .filter((x): x is CartItem => x !== null);

    setCart((prev) => {
      // Merge: skip duplicates
      const existing = new Set(prev.map((c) => `${c.productId}-${c.supplierId}`));
      return [...prev, ...newItems.filter((n) => !existing.has(`${n.productId}-${n.supplierId}`))];
    });
  };

  // ── Loading state ────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <TopBar title="Smart Ordering" />
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
          <p className="mt-3 text-sm text-gray-500">Loading products &amp; orders...</p>
        </div>
      </>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <>
      <TopBar title="Smart Ordering" />

      {/* Tabs + Search */}
      <div className="sticky top-[73px] z-30 border-b border-gray-100 bg-white px-4 py-2">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="flex gap-1">
            {([
              { id: "suggested" as const, label: "Products", icon: Package },
              { id: "reorder" as const, label: "Quick Reorder", icon: RotateCcw },
              { id: "history" as const, label: "History", icon: History },
            ]).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-terracotta text-white"
                      : "text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {(activeTab === "suggested") && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search products by name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-4">
          {/* ── Products tab ── */}
          {activeTab === "suggested" && (
            <>
              {/* Needs Ordering section */}
              {needsOrdering.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <h2 className="text-sm font-semibold text-red-700">Needs Ordering</h2>
                    <Badge className="bg-red-500 text-[10px]">
                      {needsOrdering.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {(showAllNeeds ? needsOrdering : needsOrdering.slice(0, 10)).map((item) => {
                      const pct = item.parLevel > 0 ? Math.min(100, Math.round((item.currentQty / item.parLevel) * 100)) : 0;
                      const barColor = item.status === "critical" ? "bg-red-500" : "bg-amber-500";
                      const inCartAlready = item.supplier && isInCart(item.productId, item.supplier.id);
                      const pkgQty = item.supplierProduct ? Math.max(1, Math.ceil(item.suggestedOrderQty / (item.supplierProduct.conversionFactor || 1))) : 1;
                      const cartItem = item.supplier
                        ? cart.find((c) => c.productId === item.productId && c.supplierId === item.supplier!.id)
                        : null;

                      return (
                        <Card
                          key={item.productId}
                          className={`overflow-hidden ${
                            item.status === "critical"
                              ? "border-red-200 bg-red-50/30"
                              : "border-amber-200 bg-amber-50/30"
                          }`}
                        >
                          <div className="px-3 py-2.5">
                            <div className="flex items-start justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {item.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {item.sku}
                                  {item.supplier && item.supplierProduct && (
                                    <> &middot; {item.supplier.name} &middot; RM {item.supplierProduct.price.toFixed(2)}/{item.supplierProduct.packageLabel}</>
                                  )}
                                </p>
                              </div>
                              <Badge
                                className={`ml-2 text-[10px] ${
                                  item.daysLeft < 0.1
                                    ? "bg-red-600"
                                    : item.daysLeft < 1
                                      ? "bg-red-500"
                                      : "bg-amber-500"
                                }`}
                              >
                                {item.daysLeft < 0.1 ? "OUT" : `${item.daysLeft.toFixed(1)}d left`}
                              </Badge>
                            </div>

                            {/* Stock bar */}
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                                <div
                                  className={`h-1.5 rounded-full ${barColor}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="whitespace-nowrap text-[10px] text-gray-400">
                                {item.currentQty.toLocaleString()}/{item.parLevel.toLocaleString()} {item.baseUom}
                              </span>
                            </div>

                            {/* Add button / qty controls */}
                            <div className="mt-2 flex items-center justify-end">
                              {inCartAlready && cartItem ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => updateCartQty(item.productId, item.supplier!.id, -1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 active:bg-gray-200"
                                  >
                                    <Minus className="h-3.5 w-3.5" />
                                  </button>
                                  <span className="min-w-[2rem] text-center text-sm font-semibold">
                                    {cartItem.qty}
                                  </span>
                                  <button
                                    onClick={() => updateCartQty(item.productId, item.supplier!.id, 1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark active:bg-terracotta/20"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : item.supplier && item.supplierProduct ? (
                                <Button
                                  size="sm"
                                  className={`h-7 text-xs ${
                                    item.status === "critical"
                                      ? "bg-red-600 hover:bg-red-700"
                                      : "bg-amber-600 hover:bg-amber-700"
                                  }`}
                                  onClick={() =>
                                    addToCart({
                                      productId: item.productId,
                                      name: item.name,
                                      sku: item.sku,
                                      supplier: item.supplier!.name,
                                      supplierId: item.supplier!.id,
                                      supplierPhone: item.supplier!.phone,
                                      qty: pkgQty,
                                      uom: item.supplierProduct!.packageLabel,
                                      unitPrice: item.supplierProduct!.price,
                                      packageId: item.supplierProduct!.packageId,
                                    })
                                  }
                                >
                                  <Plus className="mr-1 h-3 w-3" />
                                  Add {pkgQty} {item.supplierProduct.packageLabel}
                                </Button>
                              ) : (
                                <span className="text-xs text-gray-400">No supplier linked</span>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                    {!showAllNeeds && needsOrdering.length > 10 && (
                      <button
                        onClick={() => setShowAllNeeds(true)}
                        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Show {needsOrdering.length - 10} more items
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* All Products by supplier — search required */}
              {needsOrdering.length === 0 && supplierProducts.length === 0 ? (
                <div className="py-12 text-center">
                  <Search className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {search && search.trim().length >= 2
                      ? "No products match your search"
                      : "Search for a product to add to your order"}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {!search || search.trim().length < 2
                      ? `${suppliers.reduce((acc, s) => acc + s.products.length, 0)} products from ${suppliers.length} suppliers available`
                      : "Try a different keyword or SKU"}
                  </p>
                </div>
              ) : (
                <>
                {supplierProducts.length > 0 && (
                  <div className="flex items-center gap-2 pt-2">
                    <Package className="h-4 w-4 text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-600">Search Results</h2>
                    <Badge className="bg-gray-100 text-[10px] text-gray-600">
                      {supplierProducts.reduce((acc, s) => acc + s.products.length, 0)} found
                    </Badge>
                  </div>
                )}
                {supplierProducts.map((supplier) => (
                  <div key={supplier.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-gray-900">{supplier.name}</h2>
                      <Badge className="bg-terracotta/10 text-[10px] text-terracotta-dark">
                        {supplier.products.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {supplier.products.map((product) => {
                        const inCart = isInCart(product.id, supplier.id);
                        const cartItem = cart.find(
                          (c) => c.productId === product.id && c.supplierId === supplier.id
                        );

                        return (
                          <Card key={`${supplier.id}-${product.id}`} className="overflow-hidden">
                            <div className="px-3 py-2.5">
                              <div className="flex items-start justify-between">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-gray-900">
                                    {product.name}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {product.sku} &middot; {product.packageLabel}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold text-gray-900">
                                    RM {(product.price * (cartItem?.qty || 1)).toFixed(2)}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    RM {product.price.toFixed(2)}/{product.packageLabel}
                                  </p>
                                </div>
                              </div>

                              {/* Add / quantity controls */}
                              <div className="mt-2 flex items-center justify-end">
                                {inCart ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => updateCartQty(product.id, supplier.id, -1)}
                                      className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 active:bg-gray-200"
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                    </button>
                                    <span className="min-w-[2rem] text-center text-sm font-semibold">
                                      {cartItem?.qty}
                                    </span>
                                    <button
                                      onClick={() => updateCartQty(product.id, supplier.id, 1)}
                                      className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark active:bg-terracotta/20"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      addToCart({
                                        productId: product.id,
                                        name: product.name,
                                        sku: product.sku,
                                        supplier: supplier.name,
                                        supplierId: supplier.id,
                                        supplierPhone: supplier.phone,
                                        qty: 1,
                                        uom: product.packageLabel,
                                        unitPrice: product.price,
                                        packageId: product.packageId,
                                      })
                                    }
                                  >
                                    <Plus className="mr-1 h-3 w-3" />
                                    Add
                                  </Button>
                                )}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
                </>
              )}
            </>
          )}

          {/* ── Quick Reorder tab ── */}
          {activeTab === "reorder" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Repeat a previous order with one tap</p>
              {quickReorders.length === 0 ? (
                <div className="py-12 text-center">
                  <RotateCcw className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">No previous orders to reorder</p>
                </div>
              ) : (
                quickReorders.map((order) => (
                  <Card key={order.id} className="overflow-hidden">
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{order.supplier}</p>
                          <p className="text-xs text-gray-400">
                            {order.orderNumber} &middot;{" "}
                            {new Date(order.createdAt).toLocaleDateString("en-MY", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 bg-green-600 text-xs hover:bg-green-700"
                          onClick={() => handleReorder(order)}
                        >
                          <MessageCircle className="mr-1 h-3 w-3" />
                          Reorder
                        </Button>
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {order.items.map((item, i) => (
                          <p key={i} className="text-xs text-gray-500">
                            {item.quantity} {item.package} &mdash; {item.product}
                          </p>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* ── Order History tab ── */}
          {activeTab === "history" && (
            <div className="space-y-1.5">
              {orders.length === 0 ? (
                <div className="py-12 text-center">
                  <Clock className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">No orders yet</p>
                </div>
              ) : (
                orders.map((order) => (
                  <Card key={order.id} className="px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{order.supplier}</p>
                        <p className="text-xs text-gray-400">
                          {order.orderNumber} &middot; {order.items.length} items &middot;{" "}
                          {new Date(order.createdAt).toLocaleDateString("en-MY", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          RM {order.totalAmount.toFixed(0)}
                        </span>
                        <Badge
                          className={`text-[10px] ${
                            order.status === "SENT"
                              ? "bg-green-500"
                              : order.status === "COMPLETED"
                                ? "bg-gray-400"
                                : order.status === "DRAFT"
                                  ? "bg-amber-500"
                                  : "bg-terracotta"
                          }`}
                        >
                          {order.status.toLowerCase()}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cart summary bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3 shadow-lg">
          <div className="mx-auto max-w-lg">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-gray-600">
                <ShoppingCart className="h-4 w-4" />
                {cart.length} items
              </span>
              <span className="font-semibold text-gray-900">RM {cartTotal.toFixed(2)}</span>
            </div>

            {/* Grouped by supplier -- one WhatsApp button per supplier */}
            <div className="flex flex-col gap-1.5">
              {Object.entries(cartBySupplier).map(([supplier, group]) => (
                <Button
                  key={supplier}
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => sendViaWhatsApp(supplier)}
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  Send to {supplier} ({group.items.length} items)
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp preview dialog */}
      <Dialog
        open={whatsappDialog.open}
        onOpenChange={(open) => setWhatsappDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="mx-auto max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Order to {whatsappDialog.supplier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="rounded-lg bg-green-50 p-3">
              <pre className="whitespace-pre-wrap text-xs text-gray-700">
                {whatsappDialog.message}
              </pre>
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={openWhatsApp}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="mr-1.5 h-4 w-4" />
              )}
              {sending ? "Creating order..." : "Open WhatsApp"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
