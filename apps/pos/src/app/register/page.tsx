"use client";

import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import { ProductGrid } from "@/components/register/product-grid";
import { CategoryTabs } from "@/components/register/category-tabs";
import { SearchBar } from "@/components/register/search-bar";
import { ModifierModal } from "@/components/register/modifier-modal";
import { CheckoutModal } from "@/components/register/checkout-modal";
import { POSSidebar } from "@/components/pos/pos-sidebar";
import { ShiftModal } from "@/components/pos/shift-modal";
import { OpenOrdersPanel } from "@/components/pos/open-orders-panel";
import { TransactionsPanel } from "@/components/pos/transactions-panel";
import { DiscountModal } from "@/components/pos/discount-modal";
import { ReceiptView } from "@/components/pos/receipt-view";
import { POSSettings } from "@/components/pos/pos-settings";
import { PromoIndicator } from "@/components/pos/promo-indicator";
import { RewardPickerModal } from "@/components/pos/reward-picker-modal";
import { usePOS } from "@/lib/pos-context";
import { adaptProducts } from "@/lib/product-adapter";
import { printReceipt58mm, printKitchenDocket58mm } from "@/lib/sunmi-printer";
import { lookupMemberByPhone, type LoyaltyMember } from "@/lib/customer-lookup";
import type { Product, CartItem, ModifierOption, AppliedPromotion, ProductCategory } from "@/types/database";
import { displayRM } from "@/types/database";
import { broadcastToCustomerDisplay } from "@/lib/customer-display-channel";

type ActivePage = "register" | "orders" | "transactions" | "shift" | "settings";

export default function RegisterPage() {
  const pos = usePOS();

  // UI state
  const [activePage, setActivePage] = useState<ActivePage>("register");
  const [showSidebar, setShowSidebar] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState<"open" | "close" | "report" | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showReceipt, setShowReceipt] = useState<Record<string, unknown> | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);

  // Adapt products from Supabase format to POS format (memoized)
  const allProducts = useMemo(() => adaptProducts(pos.products), [pos.products]);
  // Build tabs based on layout mode (category / tags / custom)
  const categoryList: ProductCategory[] = useMemo(() => {
    const makeTab = (slug: string, name: string, order: number): ProductCategory => ({
      id: slug, brand_id: "", name, slug, sort_order: order,
      storehub_category_id: null, is_active: true, created_at: "",
    });

    const tabs: ProductCategory[] = [makeTab("all", "All", 0)];

    // Always add Popular if we have data
    if (pos.popularProductIds.length > 0) {
      tabs.push(makeTab("popular", "⭐ Popular", 0.5));
    }

    if (pos.layoutMode === "tags") {
      // Tags mode: tabs from unique product tags
      const tagSet = new Set<string>();
      for (const p of allProducts) { for (const t of (p.tags ?? [])) tagSet.add(t); }
      [...tagSet].sort().forEach((tag, i) => {
        tabs.push(makeTab(`tag:${tag}`, tag.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), i + 1));
      });
    } else if (pos.layoutMode === "custom" && pos.customLayouts.length > 0) {
      // Custom mode: tabs from pos_register_layouts
      pos.customLayouts.forEach((layout, i) => {
        tabs.push(makeTab(`custom:${layout.id}`, layout.name, i + 1));
      });
    } else {
      // Default: category mode
      pos.categories.forEach((cat, i) => {
        tabs.push(makeTab(cat, cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), i + 1));
      });
    }

    return tabs;
  }, [pos.categories, pos.popularProductIds.length, pos.layoutMode, pos.customLayouts, allProducts]);

  // Register state
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutQueueNumber, setCheckoutQueueNumber] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");
  const [search, setSearch] = useState("");
  const [discount, setDiscount] = useState(0);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [loyaltyMember, setLoyaltyMember] = useState<LoyaltyMember | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);
  const [showOrderNotes, setShowOrderNotes] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showOrderDiscount, setShowOrderDiscount] = useState(false);
  const [inlineDiscountType, setInlineDiscountType] = useState<"percent" | "fixed">("percent");
  const [inlineDiscountValue, setInlineDiscountValue] = useState("");
  const [appliedManualPromo, setAppliedManualPromo] = useState<AppliedPromotion | null>(null);

  // Loyalty reward state
  const [showRewardPicker, setShowRewardPicker] = useState(false);
  const [rewardDiscount, setRewardDiscount] = useState(0); // in sen
  const [rewardName, setRewardName] = useState<string | null>(null);
  const [rewardRedemptionId, setRewardRedemptionId] = useState<string | null>(null);

  // Auto-evaluate promotions on cart change
  const autoPromotions = useMemo(
    () => [] as AppliedPromotion[],
    [cart, pos.outlet?.id ?? ""]
  );
  const autoPromoDiscount = autoPromotions.reduce((sum, p) => sum + p.discountAmount, 0);
  const manualPromoDiscount = appliedManualPromo?.discountAmount ?? 0;
  const manualPromotions = useMemo(
    () => [],
    []
  );

  // Auto-show shift modal
  useEffect(() => {
    if (!pos.isShiftOpen) setShowShiftModal("open");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredProducts = useMemo(() => {
    let products = [...allProducts];

    if (activeCategory === "popular") {
      products = pos.popularProductIds
        .map((id) => allProducts.find((p) => p.id === id))
        .filter(Boolean) as Product[];
    } else if (activeCategory.startsWith("tag:")) {
      // Tags mode filter
      const tag = activeCategory.substring(4);
      products = products.filter((p) => (p.tags ?? []).includes(tag));
    } else if (activeCategory.startsWith("custom:")) {
      // Custom mode filter — match by product_ids, include_categories, include_tags
      const layoutId = activeCategory.substring(7);
      const layout = pos.customLayouts.find((l) => l.id === layoutId);
      if (layout) {
        products = products.filter((p) => {
          // Match by explicit product ID
          if ((layout.product_ids ?? []).includes(p.id)) return true;
          // Match by category
          if ((layout.include_categories ?? []).includes(p.category ?? "")) return true;
          // Match by tag
          if ((layout.include_tags ?? []).some((t: string) => (p.tags ?? []).includes(t))) return true;
          return false;
        });
      }
    } else if (activeCategory !== "all") {
      // Category mode filter
      products = products.filter((p) => p.category === activeCategory);
    }

    if (search) {
      const q = search.toLowerCase();
      products = products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
    }
    return products;
  }, [allProducts, activeCategory, search, pos.popularProductIds, pos.customLayouts]);

  // Cart count per product for badges
  const cartCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of cart) {
      const id = item.product.id;
      counts[id] = (counts[id] ?? 0) + item.quantity;
    }
    return counts;
  }, [cart]);

  // ─── Cart ────────────────────────────────────────────────

  function handleProductTap(product: Product) {
    if (!pos.isShiftOpen) { setShowShiftModal("open"); return; }
    if (product.modifiers.length > 0) setModifierProduct(product);
    else addToCart(product, []);
  }

  function addToCart(product: Product, selectedModifiers: { group_name: string; option: ModifierOption }[]) {
    const modifierTotal = selectedModifiers.reduce((sum, m) => sum + m.option.price, 0);
    setCart((prev) => [...prev, {
      cartItemId: crypto.randomUUID(),
      product, variant: null, selectedModifiers,
      quantity: 1, notes: "",
      unitPrice: product.price, modifierTotal,
      lineTotal: product.price + modifierTotal,
    }]);
    setModifierProduct(null);
  }

  function updateQuantity(id: string, delta: number) {
    setCart((prev) => prev.map((item) => {
      if (item.cartItemId !== id) return item;
      const q = item.quantity + delta;
      return q <= 0 ? null : { ...item, quantity: q, lineTotal: (item.unitPrice + item.modifierTotal) * q };
    }).filter(Boolean) as CartItem[]);
  }

  function removeItem(id: string) { setCart((prev) => prev.filter((i) => i.cartItemId !== id)); }

  function clearCart() {
    setCart([]); setDiscount(0); setEditingOrderId(null);
    setTableNumber(""); setCustomerPhone(""); setOrderNotes("");
    setAppliedManualPromo(null); setLoyaltyMember(null);
    setRewardDiscount(0); setRewardName(null); setRewardRedemptionId(null);
  }

  const subtotal = cart.reduce((sum, i) => sum + i.lineTotal, 0);
  const serviceCharge = orderType === "dine_in" ? Math.round(subtotal * pos.serviceChargeRate / 10000) : 0;
  const promoDiscount = autoPromoDiscount + manualPromoDiscount;
  const totalDiscount = discount + promoDiscount + rewardDiscount;
  const total = Math.max(0, subtotal + serviceCharge - totalDiscount);
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  // ─── Customer Display sync ──────────────────────────────
  useEffect(() => {
    broadcastToCustomerDisplay({
      items: cart.map((i) => ({
        name: i.product.name,
        qty: i.quantity,
        amount: i.lineTotal,
        modifiers: i.selectedModifiers.map((m) => m.option.name).join(", ") || undefined,
      })),
      subtotal,
      serviceCharge,
      discount: totalDiscount,
      total,
      outletId: pos.outlet?.id ?? "",
      outletName: pos.outlet?.name ?? "Celsius Coffee",
      status: cart.length === 0 ? "idle" : "ordering",
    });
  }, [cart, subtotal, serviceCharge, totalDiscount, total, pos.outlet?.id, pos.outlet?.name]);

  // ─── Send to Kitchen ─────────────────────────────────────

  async function handleSendToKitchen() {
    if (cart.length === 0) return;
    if (!tableNumber) { setShowTablePicker(true); return; }

    try {
      const order = await pos.createPOSOrder({
        orderType: "dine_in",
        tableNumber,
        queueNumber: null,
        cart,
        subtotal,
        serviceCharge,
        discount,
        promoDiscount: promoDiscount,
        promoName: null,
        total,
        customerPhone: customerPhone || null,
        customerName: null,
        notes: orderNotes || null,
        paymentMethod: "",
        status: "sent_to_kitchen",
      });
      // Print order slip + receipt together
      const outletInfo = {
        name: pos.outlet?.name ?? "Celsius Coffee",
        address: pos.outlet?.address,
        city: pos.outlet?.city,
        state: pos.outlet?.state,
        phone: pos.outlet?.phone,
      };
      const receiptConfig = {
        showLogo: (pos.branchSettings as any)?.receipt_show_logo !== false,
        qrUrl: (pos.branchSettings as any)?.receipt_qr_url || "",
        qrLabel: (pos.branchSettings as any)?.receipt_qr_label || "",
        promoEnabled: (pos.branchSettings as any)?.receipt_promo_enabled === true,
        promoText: (pos.branchSettings as any)?.receipt_promo_text || "",
        receiptFooter: (pos.branchSettings as any)?.receipt_footer || "",
      };
      setTimeout(async () => {
        try {
          await printKitchenDocket58mm(order, outletInfo);
        } catch (e) {
          console.error("[PRINT] Kitchen docket failed:", e);
        }
        try {
          await printReceipt58mm(order, outletInfo, receiptConfig);
        } catch (e) {
          console.error("[PRINT] Receipt failed:", e);
        }
      }, 300);
      clearCart();
    } catch (err) {
      console.error("Send to kitchen failed:", err);
      alert("Failed to send order. Please try again.");
    }
  }

  function handleLoadOrder(order: Record<string, unknown>) {
    // Convert DB order items back to CartItem format
    const dbItems = (order.pos_order_items ?? []) as any[];
    const cartItems: CartItem[] = dbItems.map((item: any) => {
      // Find the product in allProducts to get full product data
      const product = allProducts.find((p) => p.id === item.product_id);
      const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
      const modifierTotal = mods.reduce((sum: number, m: any) => sum + (m.option?.price ?? 0), 0);
      return {
        cartItemId: crypto.randomUUID(),
        product: product ?? {
          id: item.product_id,
          brand_id: "",
          storehub_id: null,
          name: item.product_name,
          sku: null,
          category: null,
          tags: [],
          description: null,
          image_url: null,
          image_urls: [],
          price: item.unit_price,
          cost: null,
          online_price: null,
          tax_code: null,
          tax_rate: 0,
          pricing_type: "fixed" as const,
          modifiers: [],
          track_stock: false,
          stock_level: null,
          kitchen_station: item.kitchen_station ?? null,
          is_available: true,
          is_featured: false,
          synced_at: null,
          created_at: "",
          updated_at: "",
        },
        variant: item.variant_name ?? null,
        selectedModifiers: mods.map((m: any) => ({
          group_name: m.group_name ?? "",
          option: { name: m.option?.name ?? "", price: m.option?.price ?? 0 },
        })),
        quantity: item.quantity,
        notes: item.notes ?? "",
        unitPrice: item.unit_price,
        modifierTotal,
        lineTotal: item.item_total,
      };
    });

    setCart(cartItems);
    setDiscount(Number(order.discount_amount ?? 0));
    setOrderType((order.order_type as string) === "dine_in" ? "dine_in" : "takeaway");
    setTableNumber((order.table_number as string) ?? "");
    setEditingOrderId(order.id as string);
    setActivePage("register");
  }

  // ─── Checkout ────────────────────────────────────────────

  async function handleCheckoutComplete(orderNumber: string, queueNumber: string, paymentMethod: string) {
    try {
      const order = await pos.createPOSOrder({
        orderType,
        tableNumber: orderType === "dine_in" ? tableNumber : null,
        queueNumber: orderType === "takeaway" ? queueNumber : null,
        cart,
        subtotal,
        serviceCharge,
        discount,
        promoDiscount: promoDiscount,
        promoName: null,
        total,
        customerPhone: customerPhone || null,
        customerName: null,
        notes: orderNotes || null,
        paymentMethod,
        status: "completed",
        loyaltyPhone: (loyaltyMember?.phone ?? customerPhone) || null,
        rewardId: rewardRedemptionId,
        rewardName,
        rewardDiscount,
      });

      // Award loyalty points if member is identified
      if (loyaltyMember && total > 0 && pos.outlet) {
        try {
          await fetch("/api/loyalty/earn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              member_id: loyaltyMember.id,
              outlet_id: pos.outlet.id,
              amount_rm: total / 100, // sen → RM
              order_id: order.id,
              order_number: order.order_number,
            }),
          });
        } catch (e) {
          console.error("[LOYALTY] Points earning failed:", e);
        }
      }

      // Show "Thank You" on customer display
      broadcastToCustomerDisplay({
        items: [], subtotal: 0, serviceCharge: 0, discount: 0, total,
        outletId: pos.outlet?.id ?? "", outletName: pos.outlet?.name ?? "Celsius Coffee",
        status: "complete", orderNumber: order.order_number, paymentMethod,
      });

      setShowCheckout(false);
      clearCart();

      // Auto-print: kitchen docket(s) + customer receipt
      const outletInfo = {
        name: pos.outlet?.name ?? "Celsius Coffee",
        address: pos.outlet?.address,
        city: pos.outlet?.city,
        state: pos.outlet?.state,
        phone: pos.outlet?.phone,
      };
      const receiptConfig = {
        showLogo: (pos.branchSettings as any)?.receipt_show_logo !== false,
        qrUrl: (pos.branchSettings as any)?.receipt_qr_url || "",
        qrLabel: (pos.branchSettings as any)?.receipt_qr_label || "",
        promoEnabled: (pos.branchSettings as any)?.receipt_promo_enabled === true,
        promoText: (pos.branchSettings as any)?.receipt_promo_text || "",
        receiptFooter: (pos.branchSettings as any)?.receipt_footer || "",
      };
      setTimeout(async () => {
        try {
          await printKitchenDocket58mm(order, outletInfo);
        } catch (e) {
          console.error("[PRINT] Kitchen docket failed:", e);
        }
        try {
          await printReceipt58mm(order, outletInfo, receiptConfig);
        } catch (e) {
          console.error("[PRINT] Receipt failed:", e);
        }
        setShowReceipt(order as unknown as Record<string, unknown>);
      }, 300);
    } catch (err) {
      console.error("Order creation failed:", err);
      alert("Failed to create order. Please try again.");
    }
  }

  // ─── Open checkout ────────────────────────────────────────

  async function handleOpenCheckout() {
    if (cart.length === 0) return;
    if (!pos.isShiftOpen) {
      setShowShiftModal("open");
      return;
    }
    if (orderType === "takeaway") {
      try {
        const qn = await pos.nextQueueNumber();
        setCheckoutQueueNumber(qn);
      } catch (err) {
        console.error("Queue number error:", err);
        setCheckoutQueueNumber(`TA-${Date.now() % 10000}`);
      }
    }
    setShowCheckout(true);
  }

  // ─── Keyboard shortcuts ──────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "/" && activePage === "register") { e.preventDefault(); document.querySelector<HTMLInputElement>('[placeholder="Search products..."]')?.focus(); }
      if (e.key === "Escape") {
        if (showCheckout) setShowCheckout(false);
        else if (showDiscount) setShowDiscount(false);
        else if (modifierProduct) setModifierProduct(null);
        else if (showSidebar) setShowSidebar(false);
        else if (showReceipt) setShowReceipt(null);
      }
      if (e.key === "Enter" && !e.shiftKey && activePage === "register" && cart.length > 0 && !showCheckout && !showDiscount && !modifierProduct) handleOpenCheckout();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePage, cart.length, showCheckout, showDiscount, modifierProduct, showSidebar, showReceipt]);

  // ─── Render ──────────────────────────────────────────────

  if (pos.isLoading) {
    return (
      <div className="pos-screen flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius" width={48} height={48} className="rounded-xl" />
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
          <p className="text-xs text-text-muted">Loading POS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-screen flex h-screen bg-surface-alt">
      {/* LEFT */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <button onClick={() => setShowSidebar(true)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-hover" title="Menu (M)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius" width={32} height={32} className="rounded-lg" />
          <Image src="/images/celsius-wordmark-white.png" alt="Celsius Coffee" width={90} height={20} className="hidden sm:block" />
          <div className="flex-1" />

          {activePage === "register" && <SearchBar value={search} onChange={setSearch} />}

          {/* Open orders badge */}
          {pos.openOrders.length > 0 && (
            <button
              onClick={() => setActivePage(activePage === "orders" ? "register" : "orders")}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activePage === "orders" ? "bg-blue-500/20 text-blue-400" : "border border-border text-text-muted hover:bg-surface-hover"
              }`}
            >
              <span>📋</span>
              <span>{pos.openOrders.length} Open</span>
            </button>
          )}

          {/* Order type toggle */}
          {activePage === "register" && (
            <div className="flex rounded-lg border border-border text-sm">
              <button onClick={() => setOrderType("dine_in")} className={`rounded-l-lg px-4 py-2 font-medium transition-colors ${orderType === "dine_in" ? "bg-brand text-white" : "text-text-muted hover:bg-surface-hover"}`}>
                Dine-in
              </button>
              <button onClick={() => setOrderType("takeaway")} className={`rounded-r-lg px-4 py-2 font-medium transition-colors ${orderType === "takeaway" ? "bg-brand text-white" : "text-text-muted hover:bg-surface-hover"}`}>
                Takeaway
              </button>
            </div>
          )}

          {/* Shift + Staff indicator */}
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span className={`h-2.5 w-2.5 rounded-full ${pos.isShiftOpen ? "bg-success" : "bg-danger"}`} />
            <span className="text-sm text-text-muted">{pos.staff?.name ?? "—"}</span>
          </div>
        </div>

        {/* Page content */}
        {activePage === "register" && (
          <>
            <CategoryTabs categories={categoryList} active={activeCategory} onChange={setActiveCategory} />
            <div className="flex-1 overflow-y-auto p-2">
              <ProductGrid
                products={filteredProducts}
                onProductTap={handleProductTap}
                onToggleAvailability={async (product) => {
                  const newAvail = !product.is_available;
                  try {
                    const { createClient } = await import("@/lib/supabase-browser");
                    const supabase = createClient();
                    await supabase.from("products").update({ is_available: newAvail }).eq("id", product.id);
                    await pos.loadProducts();
                  } catch (err) {
                    console.error("Toggle availability failed:", err);
                  }
                }}
                cartCounts={cartCounts}
                columns={(pos.branchSettings as any)?.grid_columns ?? 5}
              />
            </div>
          </>
        )}

        {activePage === "orders" && <div className="flex-1"><OpenOrdersPanel onLoadOrder={handleLoadOrder} /></div>}
        {activePage === "transactions" && <div className="flex-1"><TransactionsPanel onBack={() => setActivePage("register")} /></div>}
        {activePage === "settings" && <div className="flex-1 overflow-y-auto"><POSSettings /></div>}
        {activePage === "shift" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <button onClick={() => setShowShiftModal(pos.isShiftOpen ? "report" : "open")} className="rounded-xl bg-brand px-8 py-4 text-sm font-semibold text-white hover:bg-brand-dark">
              {pos.isShiftOpen ? "View Shift Report" : "Open Shift"}
            </button>
            {pos.isShiftOpen && (
              <button onClick={() => setShowShiftModal("close")} className="rounded-xl bg-danger px-8 py-4 text-sm font-semibold text-white hover:bg-danger/80">
                Close Shift
              </button>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: Order panel */}
      {activePage === "register" && (
        <div className="flex w-[360px] min-w-[360px] flex-col border-l border-border bg-surface">
          {/* Order header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">{editingOrderId ? "Edit Order" : "Current Order"}</h2>
              <span className="text-sm text-text-muted">
                {orderType === "dine_in" ? "Dine-in" : "Takeaway"}
                {tableNumber && ` · Table ${tableNumber}`}
                {customerPhone && ` · ${customerPhone}`}
                {" · "}{itemCount} item{itemCount !== 1 ? "s" : ""}
              </span>
            </div>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs font-medium text-danger hover:underline">Clear All</button>
            )}
          </div>

          {/* Order action bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setShowCustomerLookup(!showCustomerLookup)}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${customerPhone ? "text-brand" : "text-text-dim hover:text-text-muted"}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>{customerPhone || "Customer"}</span>
            </button>
            {orderType === "dine_in" && (
              <button
                onClick={() => setShowTablePicker(!showTablePicker)}
                className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${tableNumber ? "text-brand" : "text-text-dim hover:text-text-muted"}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                <span>{tableNumber ? `Table ${tableNumber}` : "Table"}</span>
              </button>
            )}
            <button
              onClick={() => setShowOrderNotes(!showOrderNotes)}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${orderNotes ? "text-brand" : "text-text-dim hover:text-text-muted"}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Notes</span>
            </button>
          </div>

          {/* Customer lookup inline */}
          {showCustomerLookup && (
            <div className="border-b border-border px-4 py-3">
              <div className="flex gap-2">
                <input
                  type="tel" placeholder="Customer phone (+60...)" value={customerPhone}
                  onChange={(e) => { setCustomerPhone(e.target.value); setLoyaltyMember(null); }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && customerPhone.length >= 10) {
                      setMemberLoading(true);
                      const m = await lookupMemberByPhone(customerPhone);
                      setLoyaltyMember(m);
                      setMemberLoading(false);
                    }
                  }}
                  className="h-10 flex-1 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text outline-none placeholder:text-text-dim focus:border-brand"
                  autoFocus
                />
                <button
                  onClick={async () => {
                    if (customerPhone.length >= 10) {
                      setMemberLoading(true);
                      const m = await lookupMemberByPhone(customerPhone);
                      setLoyaltyMember(m);
                      setMemberLoading(false);
                    }
                  }}
                  disabled={customerPhone.length < 10 || memberLoading}
                  className="rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {memberLoading ? "..." : "Lookup"}
                </button>
              </div>
              {/* Member info display */}
              {loyaltyMember && (
                <div className="mt-2 rounded-lg bg-brand/10 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-brand">{loyaltyMember.name ?? "Member"}</p>
                      <p className="text-xs text-text-muted">{loyaltyMember.phone}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-brand">{loyaltyMember.points_balance} pts</p>
                      <p className="text-xs text-text-muted">{loyaltyMember.total_visits} visits</p>
                    </div>
                  </div>
                  {loyaltyMember.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {loyaltyMember.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-brand/20 px-2.5 py-0.5 text-[11px] font-medium text-brand">{tag}</span>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-text-dim">
                    Total spent: RM {loyaltyMember.total_spent.toFixed(2)}
                  </p>
                  {loyaltyMember.points_balance > 0 && !rewardName && (
                    <button
                      onClick={() => setShowRewardPicker(true)}
                      className="mt-2 w-full rounded-lg bg-brand py-2.5 text-xs font-semibold text-white hover:bg-brand-dark"
                    >
                      Redeem Reward ({loyaltyMember.points_balance} pts)
                    </button>
                  )}
                  {rewardName && (
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-success/10 px-3 py-2">
                      <span className="text-xs font-medium text-success">{rewardName}</span>
                      <button onClick={() => { setRewardDiscount(0); setRewardName(null); setRewardRedemptionId(null); }} className="text-xs text-danger hover:underline">Remove</button>
                    </div>
                  )}
                </div>
              )}
              {loyaltyMember === null && customerPhone.length >= 10 && !memberLoading && (
                <p className="mt-1.5 text-xs text-text-dim">Press Enter or Lookup to find member</p>
              )}
            </div>
          )}

          {/* Table picker inline */}
          {showTablePicker && (
            <div className="border-b border-border px-4 py-3">
              <p className="mb-2 text-xs font-medium text-text-muted">Select Table</p>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 15 }, (_, i) => String(i + 1)).map((t) => {
                  const isOccupied = pos.openOrders.some((o) => o.table_number === t);
                  const isSelected = tableNumber === t;
                  return (
                    <button
                      key={t}
                      onClick={() => { setTableNumber(t); setShowTablePicker(false); }}
                      disabled={isOccupied && !isSelected}
                      className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                        isSelected ? "bg-brand text-white" : isOccupied ? "bg-danger/20 text-danger/50 cursor-not-allowed" : "border border-border hover:border-brand hover:bg-brand/10"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order notes inline */}
          {showOrderNotes && (
            <div className="border-b border-border px-4 py-3">
              <textarea
                placeholder="Order notes..." value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-brand"
                autoFocus
              />
            </div>
          )}

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-text-muted">
                <span className="text-3xl">🛒</span>
                <p className="mt-2 text-sm">No items yet</p>
                <p className="text-xs text-text-dim">Tap a product to add it</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {cart.map((item) => {
                  const isExpanded = expandedItemId === item.cartItemId;
                  return (
                    <div key={item.cartItemId} className="px-4 py-3">
                      {/* Tap item row to expand */}
                      <button
                        className="flex w-full items-start justify-between gap-2 text-left"
                        onClick={() => {
                          setExpandedItemId(isExpanded ? null : item.cartItemId);
                          setInlineDiscountValue("");
                          setInlineDiscountType("percent");
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product.name}</p>
                          {item.selectedModifiers.length > 0 && (
                            <p className="text-xs text-text-muted truncate">{item.selectedModifiers.map((m) => m.option.name).join(", ")}</p>
                          )}
                        </div>
                        <span className="text-sm font-semibold whitespace-nowrap">{displayRM(item.lineTotal)}</span>
                      </button>

                      {/* Quantity + remove */}
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => updateQuantity(item.cartItemId, -1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium hover:bg-surface-hover">-</button>
                        <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.cartItemId, 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium hover:bg-surface-hover">+</button>
                        <div className="flex-1" />
                        <button onClick={() => removeItem(item.cartItemId)} className="text-xs text-text-dim hover:text-danger">Remove</button>
                      </div>

                      {/* Inline item discount (expanded) */}
                      {isExpanded && (
                        <div className="mt-2 rounded-lg bg-surface-alt p-3">
                          <p className="mb-2 text-xs font-medium text-text-muted">Item Discount</p>
                          <div className="flex gap-1.5 mb-2">
                            <button onClick={() => { setInlineDiscountType("percent"); setInlineDiscountValue(""); }}
                              className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountType === "percent" ? "bg-brand text-white" : "bg-surface text-text-muted"}`}>%</button>
                            <button onClick={() => { setInlineDiscountType("fixed"); setInlineDiscountValue(""); }}
                              className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountType === "fixed" ? "bg-brand text-white" : "bg-surface text-text-muted"}`}>RM</button>
                          </div>
                          <div className="flex gap-1.5">
                            {inlineDiscountType === "percent"
                              ? [10, 20, 50, 100].map((pct) => (
                                  <button key={pct} onClick={() => setInlineDiscountValue(String(pct))}
                                    className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountValue === String(pct) ? "bg-brand/20 text-brand" : "bg-surface hover:bg-surface-hover"}`}>{pct}%</button>
                                ))
                              : <input type="number" step="0.01" value={inlineDiscountValue} onChange={(e) => setInlineDiscountValue(e.target.value)}
                                  placeholder="RM" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" autoFocus />
                            }
                          </div>
                          {parseFloat(inlineDiscountValue) > 0 && (
                            <button
                              onClick={() => {
                                const val = parseFloat(inlineDiscountValue);
                                const amt = inlineDiscountType === "percent"
                                  ? Math.round(item.lineTotal * (val / 100))
                                  : Math.round(val * 100);
                                setCart((prev) => prev.map((ci) =>
                                  ci.cartItemId === item.cartItemId
                                    ? { ...ci, lineTotal: Math.max(0, ci.lineTotal - amt) }
                                    : ci
                                ));
                                setExpandedItemId(null);
                                setInlineDiscountValue("");
                              }}
                              className="mt-2 w-full rounded-lg bg-success/20 py-2 text-xs font-medium text-success hover:bg-success/30"
                            >
                              Apply -{inlineDiscountType === "percent" ? `${inlineDiscountValue}%` : `RM ${inlineDiscountValue}`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Promotions + Totals + Charge */}
          <div className="border-t border-border px-4 py-3">
            {/* Promotion indicators */}
            <PromoIndicator
              autoPromotions={autoPromotions}
              manualPromotions={manualPromotions}
              cart={cart}
              appliedManualPromo={appliedManualPromo}
              onApplyManual={(p) => setAppliedManualPromo(p)}
              onRemoveManual={() => setAppliedManualPromo(null)}
            />

            <div className="mb-3 space-y-1 text-sm">
              {/* Tap subtotal to add order discount */}
              <button className="flex w-full justify-between hover:text-brand" onClick={() => { setShowOrderDiscount(!showOrderDiscount); setInlineDiscountValue(""); setInlineDiscountType("percent"); }}>
                <span className="text-text-muted">Subtotal {cart.length > 0 && !discount ? "(tap to discount)" : ""}</span><span>{displayRM(subtotal)}</span>
              </button>
              {serviceCharge > 0 && <div className="flex justify-between"><span className="text-text-muted">Service Charge</span><span>{displayRM(serviceCharge)}</span></div>}
              {discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-success">Discount</span>
                  <button className="text-success hover:underline" onClick={() => setDiscount(0)}>-{displayRM(discount)} ✕</button>
                </div>
              )}
              {promoDiscount > 0 && <div className="flex justify-between"><span className="text-text-muted">Promo</span><span className="text-success">-{displayRM(promoDiscount)}</span></div>}
              {rewardDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-brand">Reward: {rewardName}</span>
                  <button className="text-brand hover:underline" onClick={() => { setRewardDiscount(0); setRewardName(null); setRewardRedemptionId(null); }}>-{displayRM(rewardDiscount)} ✕</button>
                </div>
              )}

              {/* Inline order discount */}
              {showOrderDiscount && cart.length > 0 && (
                <div className="rounded-lg bg-surface-alt p-3 my-1">
                  <div className="flex gap-1.5 mb-2">
                    <button onClick={() => { setInlineDiscountType("percent"); setInlineDiscountValue(""); }}
                      className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountType === "percent" ? "bg-brand text-white" : "bg-surface text-text-muted"}`}>%</button>
                    <button onClick={() => { setInlineDiscountType("fixed"); setInlineDiscountValue(""); }}
                      className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountType === "fixed" ? "bg-brand text-white" : "bg-surface text-text-muted"}`}>RM</button>
                  </div>
                  <div className="flex gap-1.5">
                    {inlineDiscountType === "percent"
                      ? [5, 10, 20, 50].map((pct) => (
                          <button key={pct} onClick={() => setInlineDiscountValue(String(pct))}
                            className={`flex-1 rounded-lg py-2 text-xs font-medium ${inlineDiscountValue === String(pct) ? "bg-brand/20 text-brand" : "bg-surface hover:bg-surface-hover"}`}>{pct}%</button>
                        ))
                      : <input type="number" step="0.01" value={inlineDiscountValue} onChange={(e) => setInlineDiscountValue(e.target.value)}
                          placeholder="RM" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" autoFocus />
                    }
                  </div>
                  {parseFloat(inlineDiscountValue) > 0 && (
                    <button onClick={() => {
                      const val = parseFloat(inlineDiscountValue);
                      const amt = inlineDiscountType === "percent" ? Math.round(subtotal * (val / 100)) : Math.round(val * 100);
                      setDiscount(Math.min(amt, subtotal));
                      setShowOrderDiscount(false);
                      setInlineDiscountValue("");
                    }} className="mt-2 w-full rounded-lg bg-success/20 py-2 text-xs font-medium text-success hover:bg-success/30">
                      Apply -{inlineDiscountType === "percent" ? `${inlineDiscountValue}%` : `RM ${inlineDiscountValue}`}
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-between text-lg font-bold pt-2 border-t border-border"><span>Total</span><span>{displayRM(total)}</span></div>
            </div>

            {/* Pay first → then kitchen prints (for all order types) */}
            <button disabled={cart.length === 0} onClick={() => handleOpenCheckout()} className="w-full rounded-xl bg-brand py-3.5 text-base font-bold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
              {cart.length === 0 ? "Add items to charge" : `Charge ${displayRM(total)}`}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showSidebar && <POSSidebar isOpen={showSidebar} onClose={() => setShowSidebar(false)} onNavigate={(p) => setActivePage(p as ActivePage)} activePage={activePage} />}
      {showShiftModal && <ShiftModal mode={showShiftModal} onClose={() => setShowShiftModal(null)} />}
      {showCheckout && <CheckoutModal items={cart} orderType={orderType} subtotal={subtotal} serviceCharge={serviceCharge} discount={discount} total={total} queueNumber={checkoutQueueNumber || undefined} orderNumber="" onComplete={handleCheckoutComplete} onClose={() => setShowCheckout(false)} />}
      {showDiscount && <DiscountModal
        subtotal={subtotal}
        items={cart}
        onApplyOrder={(amt) => { setDiscount(amt); setShowDiscount(false); }}
        onApplyItem={(cartItemId, amt) => {
          // Apply discount to specific item by reducing its lineTotal
          setCart((prev) => prev.map((item) => {
            if (item.cartItemId !== cartItemId) return item;
            return { ...item, lineTotal: Math.max(0, item.lineTotal - amt) };
          }));
          setShowDiscount(false);
        }}
        onClose={() => setShowDiscount(false)}
      />}
      {showReceipt && <ReceiptView order={showReceipt as any} branchName={pos.outlet?.name ?? "Celsius Coffee"} branchAddress="" onClose={() => setShowReceipt(null)} onPrint={() => {
            printReceipt58mm(showReceipt, {
              name: pos.outlet?.name ?? "Celsius Coffee",
              address: pos.outlet?.address,
              city: pos.outlet?.city,
              state: pos.outlet?.state,
              phone: pos.outlet?.phone,
            });
            setShowReceipt(null);
          }} />}
      {modifierProduct && <ModifierModal product={modifierProduct} onConfirm={(mods) => addToCart(modifierProduct, mods)} onClose={() => setModifierProduct(null)} />}
      {showRewardPicker && loyaltyMember && (
        <RewardPickerModal
          memberId={loyaltyMember.id}
          memberName={loyaltyMember.name}
          outletId={pos.outlet?.id ?? ""}
          subtotal={subtotal}
          onRedeem={(result) => {
            const d = result.discount;
            let discountSen = 0;
            if (d.type === "fixed_amount") {
              discountSen = Math.round(d.value * 100); // RM to sen
            } else if (d.type === "percentage") {
              discountSen = Math.round(subtotal * d.value / 100);
              if (d.max_discount !== null) {
                discountSen = Math.min(discountSen, Math.round(d.max_discount * 100));
              }
            } else if (d.type === "free_item") {
              // Try to find matching product price
              const freeMatch = allProducts.find((p) =>
                d.free_product_ids?.includes(p.id) ||
                p.name.toLowerCase() === (d.free_product_name ?? "").toLowerCase()
              );
              discountSen = freeMatch ? freeMatch.price : 0;
            }
            // Cap at subtotal
            discountSen = Math.min(discountSen, subtotal);
            setRewardDiscount(discountSen);
            setRewardName(result.reward_name);
            setRewardRedemptionId(result.redemption_id);
            setShowRewardPicker(false);
          }}
          onClose={() => setShowRewardPicker(false)}
        />
      )}
    </div>
  );
}
