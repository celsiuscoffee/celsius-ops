"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
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
  Sparkles,
  ArrowLeftRight,
  CheckCircle2,
  Zap,
  ChevronDown,
  X,
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

type OutletOption = {
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
  outlet: string;
  supplier: string;
  supplierPhone: string;
  supplierId: string;
  status: string;
  totalAmount: number;
  items: OrderItem[];
  createdAt: string;
};

// AI recommendation types
type AIReorderItem = {
  productId: string; productName: string; sku: string; baseUom: string;
  currentQty: number; parLevel: number; reorderPoint: number; avgDailyUsage: number;
  orderQty: number; unitPrice: number; totalPrice: number;
  productPackageId: string | null; packageName: string | null; daysUntilStockout: number;
};
type AIPORecommendation = {
  type: "purchase_order"; outletId: string; outletName: string; outletCode: string;
  supplierId: string; supplierName: string; leadTimeDays: number;
  items: AIReorderItem[]; totalAmount: number; urgency: "critical" | "low" | "restock";
};
type AITransferItem = {
  productId: string; productName: string;
  fromQty: number; toQty: number; transferQty: number; toParLevel: number;
  packageName: string | null; packageId: string | null; conversionFactor: number; baseUom: string;
};
type AITransferRecommendation = {
  type: "transfer"; fromOutletId: string; fromOutletName: string;
  toOutletId: string; toOutletName: string;
  items: AITransferItem[]; reason: string;
};
type AIData = {
  purchaseOrders: AIPORecommendation[];
  transfers: AITransferRecommendation[];
  summary: { totalPOsToCreate: number; totalReorderValue: number; criticalPOs: number; transfersNeeded: number };
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

// ── Searchable Supplier Combobox (portal-based to avoid overflow clipping) ──

function SupplierCombobox({
  value,
  onChange,
  suppliers,
}: {
  value: string;
  onChange: (id: string) => void;
  suppliers: SupplierOption[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const activeSuppliers = suppliers.filter((s) => s.products.length > 0);
  const filtered = search
    ? activeSuppliers.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : activeSuppliers;

  const selectedName = value ? suppliers.find((s) => s.id === value)?.name : null;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch("");
    }
  }, [open]);

  return (
    <>
      <div
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm ${
          open ? "border-blue-400 ring-1 ring-blue-400" : "border-gray-200"
        }`}
      >
        <span className={selectedName ? "text-gray-900" : "text-gray-400"}>
          {selectedName || "All Suppliers"}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}
              className="rounded p-0.5 hover:bg-gray-100"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </div>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
            className="rounded-md border border-gray-200 bg-white shadow-lg"
          >
            <div className="border-b p-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded border-0 bg-gray-50 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                  !value ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700"
                }`}
              >
                All Suppliers
              </button>
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onChange(s.id); setOpen(false); }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    value === s.id ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700"
                  }`}
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-gray-400">{s.products.length} products</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-gray-400">No suppliers found</div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function CreateOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");

  // Data
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [stockLevels, setStockLevels] = useState<StockLevelItem[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loading, setLoading] = useState(true);

  // Order
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [createTab, setCreateTab] = useState<"smart" | "all" | "reorder">("smart");
  const [saving, setSaving] = useState(false);

  // AI recommendations
  const [aiData, setAiData] = useState<AIData | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiAddedItems, setAiAddedItems] = useState<Set<string>>(new Set());

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

  const loadStockLevels = useCallback(async (outletId: string) => {
    if (!outletId) { setStockLevels([]); return; }
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/inventory/stock-levels?outletId=${outletId}`);
      if (res.ok) {
        const data = await res.json();
        setStockLevels(data.items || []);
      }
    } catch { /* silently fail */ }
    finally { setLoadingStock(false); }
  }, []);

  const loadAIRecommendations = useCallback(async (outletId: string) => {
    if (!outletId) { setAiData(null); return; }
    setLoadingAI(true);
    try {
      const res = await fetch(`/api/inventory/ai-decisions?outletId=${outletId}`);
      if (res.ok) setAiData(await res.json());
    } catch { /* silently fail */ }
    finally { setLoadingAI(false); }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/inventory/suppliers/products").then((r) => r.json()),
      fetch("/api/settings/outlets?status=ACTIVE").then((r) => r.json()),
      fetch("/api/inventory/orders").then((r) => r.json()),
    ]).then(([s, b, o]) => {
      setSuppliers(s.filter((sup: SupplierOption) => sup.name !== "Ad-hoc Purchase"));
      // Sort outlets: Putrajaya first, Nilai last
      const sorted = [...b].sort((a: OutletOption, b: OutletOption) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName.includes("putrajaya")) return -1;
        if (bName.includes("putrajaya")) return 1;
        if (aName.includes("nilai")) return 1;
        if (bName.includes("nilai")) return -1;
        return aName.localeCompare(bName);
      });
      setOutlets(sorted);
      setOrders(o);
      const defaultOutlet = sorted[0]?.id ?? "";
      setSelectedOutletId(defaultOutlet);
      if (defaultOutlet) {
        loadStockLevels(defaultOutlet);
        loadAIRecommendations(defaultOutlet);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [loadStockLevels, loadAIRecommendations]);

  // Load draft order into cart when ?draft=<id> is present
  useEffect(() => {
    if (!draftId || suppliers.length === 0) return;
    fetch(`/api/inventory/orders/${draftId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((draft) => {
        if (!draft || draft.status !== "DRAFT") return;
        setEditingDraftId(draft.id);
        if (draft.outletId) setSelectedOutletId(draft.outletId);
        if (draft.notes) setOrderNotes(draft.notes);
        // Map draft items to cart items using supplier data
        const supplier = suppliers.find((s) => s.id === draft.supplierId);
        if (!supplier) return;
        const cartItems: CartItem[] = draft.items.map((item: { productId: string; quantity: number; unitPrice: number; product: { name: string; sku: string; baseUom?: string }; productPackage: { packageLabel?: string; packageName?: string; id?: string } | null }) => {
          const sp = supplier.products.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            name: item.product.name,
            sku: item.product.sku,
            supplier: supplier.name,
            supplierId: supplier.id,
            supplierPhone: supplier.phone,
            packageLabel: item.productPackage?.packageLabel ?? item.productPackage?.packageName ?? item.product.baseUom ?? "pcs",
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            productPackageId: sp?.packageId ?? null,
          };
        });
        setCart(cartItems);
      })
      .catch(() => {});
  }, [draftId, suppliers]);

  const handleOutletChange = (outletId: string) => {
    setSelectedOutletId(outletId);
    setCart([]);
    setAiAddedItems(new Set());
    loadStockLevels(outletId);
    loadAIRecommendations(outletId);
  };

  // ── Derived data ────────────────────────────────────────────────────────

  // Build transfer availability map from AI data: productId → { fromOutlet, qty, packageName }
  const transferAvailableMap = new Map<string, { fromOutletId: string; fromOutletName: string; transferQty: number; packageName: string; fromQty: number; toQty: number }>();
  if (aiData?.transfers) {
    for (const t of aiData.transfers) {
      for (const item of t.items) {
        // Only add if not already mapped (first match = best surplus outlet from AI)
        if (!transferAvailableMap.has(item.productId)) {
          transferAvailableMap.set(item.productId, {
            fromOutletId: t.fromOutletId,
            fromOutletName: t.fromOutletName,
            transferQty: item.transferQty,
            packageName: item.packageName || item.baseUom || "units",
            fromQty: item.fromQty,
            toQty: item.toQty,
          });
        }
      }
    }
  }

  // Needs ordering: critical/low items matched with supplier info + transfer availability
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
      const transferOption = transferAvailableMap.get(item.productId) || null;
      return { ...item, supplier: supplierMatch, supplierProduct: productMatch, transferOption };
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

  // Quick reorder: last order per supplier for the selected outlet
  const quickReorders = (() => {
    const outlet = outlets.find((b) => b.id === selectedOutletId);
    if (!outlet) return [];
    const outletOrders = orders.filter((o) => o.outlet === outlet.name);
    const seen = new Set<string>();
    const result: Order[] = [];
    for (const order of outletOrders) {
      if (!seen.has(order.supplier) && order.items.length > 0) {
        seen.add(order.supplier);
        result.push(order);
      }
    }
    return result;
  })();

  // ── Cart helpers ────────────────────────────────────────────────────────

  const cartMatch = (c: CartItem, productId: string, supplierId: string, packageId?: string | null) =>
    c.productId === productId && c.supplierId === supplierId && c.productPackageId === (packageId ?? null);

  const isInCart = (productId: string, supplierId: string, packageId?: string | null) =>
    cart.some((c) => cartMatch(c, productId, supplierId, packageId));

  const addToCart = (item: CartItem) => {
    if (isInCart(item.productId, item.supplierId, item.productPackageId)) return;
    setCart((prev) => [...prev, item]);
  };

  const updateCartQty = (productId: string, supplierId: string, packageId: string | null, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          cartMatch(c, productId, supplierId, packageId)
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c
        )
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (productId: string, supplierId: string, packageId: string | null) => {
    setCart((prev) => prev.filter((c) => !cartMatch(c, productId, supplierId, packageId)));
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
      const existing = new Set(prev.map((c) => `${c.productId}-${c.supplierId}-${c.productPackageId}`));
      return [...prev, ...newItems.filter((n) => !existing.has(`${n.productId}-${n.supplierId}-${n.productPackageId}`))];
    });
  };

  // ── WhatsApp flow ───────────────────────────────────────────────────────

  const sendViaWhatsApp = (supplier: string) => {
    const group = cartBySupplier[supplier];
    if (!group) return;
    const outlet = outlets.find((b) => b.id === selectedOutletId);
    const deliveryDate = getDeliveryDate(group.supplierId);
    const today = new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" });
    let message = `📋 *Order from Celsius Coffee*\n`;
    message += `Outlet: ${outlet?.name || "—"}\nDate: ${today}\n\n`;
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

      let orderId = editingDraftId;

      if (editingDraftId) {
        // Update existing draft then mark as SENT
        await fetch(`/api/inventory/orders/${editingDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "SENT" }),
        });
      } else {
        // Create new order
        const orderRes = await fetch("/api/inventory/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outletId: selectedOutletId,
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
          orderId = order.id;
          await fetch(`/api/inventory/orders/${order.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "SENT" }),
          });
        }
      }

      const phone = whatsappDialog.phone.replace(/\+/g, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsappDialog.message)}`, "_blank");

      setCart((prev) => prev.filter((c) => c.supplierId !== whatsappDialog.supplierId));
      setWhatsappDialog({ open: false, supplier: "", supplierId: "", message: "", phone: "", items: [] });

      // If cart is now empty after sending, navigate back
      if (cart.filter((c) => c.supplierId !== whatsappDialog.supplierId).length === 0) {
        router.push("/inventory/orders");
      }
    } catch (err) {
      console.error("Failed to create order:", err);
    } finally {
      setSending(false);
    }
  };

  const submitAsDraft = async () => {
    const entries = Object.entries(cartBySupplier);
    if (entries.length === 0) return;
    setSaving(true);
    try {
      // If editing an existing draft, delete it first then recreate
      if (editingDraftId) {
        await fetch(`/api/inventory/orders/${editingDraftId}`, { method: "DELETE" });
      }
      for (const [, group] of entries) {
        const deliveryDate = getDeliveryDate(group.supplierId);
        const res = await fetch("/api/inventory/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outletId: selectedOutletId,
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
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`Failed to save draft: ${err.error || res.statusText}`);
          return;
        }
      }
      router.push("/inventory/orders");
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
          <Link href="/inventory/orders">
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
          {/* Outlet + controls */}
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Outlet</label>
                <select
                  value={selectedOutletId}
                  onChange={(e) => handleOutletChange(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  {outlets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Supplier</label>
                <SupplierCombobox
                  value={supplierFilter}
                  onChange={setSupplierFilter}
                  suppliers={suppliers}
                />
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
              { id: "smart" as const, label: "Smart Order", icon: Sparkles, count: needsOrdering.length + (aiData?.summary.transfersNeeded || 0) },
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

          {/* ── Smart Order tab (merged AI + Needs Ordering) ── */}
          {createTab === "smart" && (
            <div className="space-y-3">
              {loadingAI || loadingStock ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-terracotta" />
                  <span className="ml-2 text-sm text-gray-500">Analyzing stock levels...</span>
                </div>
              ) : needsOrdering.length === 0 && (!aiData || aiData.transfers.length === 0) ? (
                <Card className="py-12 text-center">
                  {stockLevels.every((i) => i.status === "no_par") ? (
                    <>
                      <Package className="mx-auto h-8 w-8 text-gray-300" />
                      <p className="mt-2 text-sm text-gray-500">No par levels set for this outlet</p>
                      <p className="mt-1 text-xs text-gray-400">Set par levels in Settings → Par Levels, or use the <button onClick={() => setCreateTab("all")} className="text-terracotta underline">All Products</button> tab to order manually</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mx-auto h-8 w-8 text-green-400" />
                      <p className="mt-2 text-sm text-gray-500">All stock levels are healthy</p>
                      <p className="mt-1 text-xs text-gray-400">Use the <button onClick={() => setCreateTab("all")} className="text-terracotta underline">All Products</button> tab to order manually</p>
                    </>
                  )}
                </Card>
              ) : (
                <>
                  {/* Summary bar */}
                  {needsOrdering.length > 0 && (
                    <Card className="px-4 py-3 border-terracotta/20 bg-terracotta/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Sparkles className="h-5 w-5 text-terracotta" />
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {needsOrdering.length} item{needsOrdering.length !== 1 ? "s" : ""} below par
                              {needsOrdering.filter((i) => i.status === "critical").length > 0 && (
                                <span className="text-red-600"> ({needsOrdering.filter((i) => i.status === "critical").length} critical)</span>
                              )}
                              {needsOrdering.filter((i) => i.transferOption).length > 0 && (
                                <span className="text-blue-600"> · {needsOrdering.filter((i) => i.transferOption).length} transferable</span>
                              )}
                            </p>
                            {aiData && aiData.summary.totalReorderValue > 0 && (
                              <p className="text-xs text-gray-500">Estimated PO value: RM {aiData.summary.totalReorderValue.toLocaleString()}</p>
                            )}
                          </div>
                        </div>
                        {needsOrdering.filter((i) => i.supplier && i.supplierProduct).length > 0 && (
                          <Button
                            size="sm"
                            className="bg-terracotta hover:bg-terracotta-dark text-xs h-8"
                            onClick={() => {
                              const newItems: CartItem[] = [];
                              for (const item of needsOrdering) {
                                if (!item.supplier || !item.supplierProduct) continue;
                                if (isInCart(item.productId, item.supplier.id, item.supplierProduct.packageId)) continue;
                                const pkgQty = Math.max(1, Math.ceil((item.suggestedOrderQty || 1) / (item.supplierProduct.conversionFactor || 1)));
                                newItems.push({
                                  productId: item.productId,
                                  productPackageId: item.supplierProduct.packageId,
                                  name: item.name, sku: item.sku,
                                  supplier: item.supplier.name, supplierId: item.supplier.id,
                                  supplierPhone: item.supplier.phone,
                                  packageLabel: item.supplierProduct.packageLabel,
                                  quantity: pkgQty, unitPrice: item.supplierProduct.price,
                                });
                              }
                              if (newItems.length > 0) setCart((prev) => [...prev, ...newItems]);
                            }}
                          >
                            <Zap className="mr-1 h-3.5 w-3.5" />
                            Add All to Cart
                          </Button>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Transfer suggestions (from AI) */}
                  {aiData && aiData.transfers.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <ArrowLeftRight className="h-4 w-4 text-blue-500" />
                        <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Transfer Instead of Ordering</h3>
                        <span className="text-[10px] text-blue-400">Save cost by using surplus from other outlets</span>
                      </div>
                      {aiData.transfers.map((t, idx) => (
                        <Card key={idx} className="px-4 py-3 mb-2 border-blue-200 bg-blue-50/30">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {t.fromOutletName} <span className="text-gray-400 mx-1">&rarr;</span> {t.toOutletName}
                              </p>
                              <p className="text-xs text-gray-500">{t.items.length} item{t.items.length !== 1 ? "s" : ""}</p>
                            </div>
                            <button
                              onClick={() => router.push(`/inventory/transfers?from=${t.fromOutletId}&to=${selectedOutletId}`)}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                            >
                              Create Transfer
                            </button>
                          </div>
                          <div className="mt-2 space-y-1">
                            {t.items.map((item) => (
                              <div key={item.productId} className="flex items-center justify-between text-xs bg-white/60 rounded px-3 py-1.5">
                                <span className="text-gray-700 font-medium">{item.productName}</span>
                                <div className="flex items-center gap-3 text-gray-500">
                                  <span>Surplus: {item.fromQty}</span>
                                  <span className="font-semibold text-blue-600">{item.transferQty} {item.packageName || item.baseUom}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}

                  {/* Items needing ordering */}
                  {needsOrdering.length > 0 && (
                    <div>
                      {aiData && aiData.transfers.length > 0 && (
                        <div className="mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-terracotta" />
                          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Order from Supplier</h3>
                        </div>
                      )}
                      <div className="space-y-2">
                        {needsOrdering.map((item) => {
                          const pct = item.parLevel > 0 ? Math.min(100, Math.round((item.currentQty / item.parLevel) * 100)) : 0;
                          const barColor = item.status === "critical" ? "bg-red-500" : "bg-amber-500";
                          const inCartAlready = item.supplier && item.supplierProduct && isInCart(item.productId, item.supplier.id, item.supplierProduct.packageId);
                          const cartItem = item.supplier && item.supplierProduct ? cart.find((c) => cartMatch(c, item.productId, item.supplier!.id, item.supplierProduct!.packageId)) : null;
                          const pkgQty = item.supplierProduct ? Math.max(1, Math.ceil((item.suggestedOrderQty || 1) / (item.supplierProduct.conversionFactor || 1))) : 1;
                          const tf = item.transferOption;

                          return (
                            <Card key={item.productId} className={`px-4 py-3 ${item.status === "critical" ? "border-red-200 bg-red-50/30" : "border-amber-200 bg-amber-50/30"}`}>
                              <div className="flex items-center justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                                    <Badge className={`text-[10px] ${(item.daysLeft ?? 0) < 0.1 ? "bg-red-600" : (item.daysLeft ?? 0) < 1 ? "bg-red-500" : "bg-amber-500"}`}>
                                      {(item.daysLeft ?? 0) < 0.1 ? "OUT" : `${(item.daysLeft ?? 0).toFixed(1)}d left`}
                                    </Badge>
                                    {tf && (
                                      <Badge className="bg-blue-100 text-blue-700 text-[10px] border border-blue-200">
                                        <ArrowLeftRight className="mr-0.5 h-2.5 w-2.5" />
                                        Transfer available
                                      </Badge>
                                    )}
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
                                      <button onClick={() => updateCartQty(item.productId, item.supplier!.id, item.supplierProduct!.packageId, -1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"><Minus className="h-3.5 w-3.5" /></button>
                                      <span className="min-w-[2rem] text-center text-sm font-bold">{cartItem.quantity}</span>
                                      <button onClick={() => updateCartQty(item.productId, item.supplier!.id, item.supplierProduct!.packageId, 1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark hover:bg-terracotta/20"><Plus className="h-3.5 w-3.5" /></button>
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

                              {/* Transfer suggestion row */}
                              {tf && (
                                <div className="mt-2 flex items-center justify-between rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <ArrowLeftRight className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                    <div className="text-xs">
                                      <span className="text-blue-800 font-medium">{tf.fromOutletName}</span>
                                      <span className="text-blue-500 mx-1">has surplus →</span>
                                      <span className="text-blue-700 font-semibold">{tf.transferQty} {tf.packageName}</span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => router.push(`/inventory/transfers?from=${tf.fromOutletId}&to=${selectedOutletId}`)}
                                    className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors"
                                  >
                                    Transfer
                                  </button>
                                </div>
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
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
                      ? `${suppliers.reduce((acc, s) => acc + s.products.length, 0)} products from ${suppliers.length} ${suppliers.length === 1 ? 'supplier' : 'suppliers'} available`
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
                        const inCart = isInCart(product.id, supplier.id, product.packageId);
                        const cartItem = cart.find((c) => cartMatch(c, product.id, supplier.id, product.packageId));
                        return (
                          <Card key={`${supplier.id}-${product.id}-${product.packageId}`} className="flex items-center justify-between px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">{product.name}</p>
                              <p className="text-xs text-gray-500">{product.sku} &middot; {product.packageLabel} &middot; RM {product.price.toFixed(2)}</p>
                            </div>
                            {inCart ? (
                              <div className="flex items-center gap-2">
                                <button onClick={() => updateCartQty(product.id, supplier.id, product.packageId, -1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"><Minus className="h-3.5 w-3.5" /></button>
                                <span className="min-w-[2rem] text-center text-sm font-bold">{cartItem?.quantity}</span>
                                <button onClick={() => updateCartQty(product.id, supplier.id, product.packageId, 1)} className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta/10 text-terracotta-dark hover:bg-terracotta/20"><Plus className="h-3.5 w-3.5" /></button>
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
                  <p className="mt-2 text-sm text-gray-400">No previous orders for this outlet</p>
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
                              <div key={`${item.productId}-${item.supplierId}-${item.productPackageId}`} className="text-xs">
                                <div className="flex items-center justify-between">
                                  <p className="truncate text-gray-700 font-medium flex-1 min-w-0">{item.name}</p>
                                  <button onClick={() => removeFromCart(item.productId, item.supplierId, item.productPackageId)} className="text-red-400 hover:text-red-600 ml-1"><Trash2 className="h-3 w-3" /></button>
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => updateCartQty(item.productId, item.supplierId, item.productPackageId, -1)} className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200"><Minus className="h-3 w-3" /></button>
                                    <input
                                      type="number"
                                      min="1"
                                      className="w-12 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs focus:border-terracotta focus:outline-none"
                                      value={item.quantity}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        const delta = val - item.quantity;
                                        if (delta !== 0) updateCartQty(item.productId, item.supplierId, item.productPackageId, delta);
                                      }}
                                    />
                                    <button onClick={() => updateCartQty(item.productId, item.supplierId, item.productPackageId, 1)} className="flex h-6 w-6 items-center justify-center rounded bg-terracotta/10 text-terracotta-dark hover:bg-terracotta/20"><Plus className="h-3 w-3" /></button>
                                    <span className="text-[10px] text-gray-400">{item.packageLabel}</span>
                                  </div>
                                  <span className="font-medium text-gray-900">RM {(item.quantity * item.unitPrice).toFixed(2)}</span>
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
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
