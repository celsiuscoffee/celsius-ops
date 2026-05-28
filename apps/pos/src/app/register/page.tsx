"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
import { ReturnsModal } from "@/components/pos/returns-modal";
import { usePOS } from "@/lib/pos-context";
import { usePickupPrinter } from "@/lib/use-pickup-printer";
import { adaptProducts } from "@/lib/product-adapter";
import { printReceipt80mm, printKitchenDocket80mm } from "@/lib/sunmi-printer";
import { lookupMemberByPhone, type LoyaltyMember } from "@/lib/customer-lookup";
import { evaluatePromotions } from "@/lib/loyalty/promotions";
import type { Product, CartItem, ModifierOption, AppliedPromotion, ProductCategory } from "@/types/database";
import { displayRM } from "@/types/database";
import {
  broadcastToCustomerDisplay,
  listenToRegisterInbox,
} from "@/lib/customer-display-channel";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
import {
  computeVoucherDiscount,
  legacyDescriptorToSpec,
  type DiscountResult,
} from "@celsius/shared";

type ActivePage = "register" | "orders" | "transactions" | "shift" | "settings";

/** Compute the discount in sen for a POS legacy descriptor against the
 *  current cart. Single source of truth shared with Pickup's order
 *  creation — both paths now flow through @celsius/shared's
 *  computeVoucherDiscount(), so the same voucher on the same cart
 *  gives the same discount on POS as on Pickup.
 *
 *  POS register prices live in sen on cart items (product.price,
 *  unitPrice, modifierTotal). The engine takes sen throughout. */
function applyDescriptorToCart(
  legacy: {
    type: string;
    value: number;
    max_discount: number | null;
    min_order: number | null;
    applicable_categories: string[] | null;
    applicable_products: string[] | null;
    free_product_ids: string[] | null;
    free_product_name: string | null;
  },
  cart: CartItem[],
): DiscountResult {
  return computeVoucherDiscount({
    spec: legacyDescriptorToSpec(legacy),
    cart: cart.map((ci) => ({
      product_id: ci.product.id,
      quantity: ci.quantity,
      // Customer's effective unit price — base + modifier upcharges.
      // Matches how the free-item cheapest-line calc historically
      // ranked POS cart lines (e.g. "Iced Latte Large + Oat" beats
      // a "Black Coffee" base).
      unit_price_sen: ci.unitPrice + ci.modifierTotal,
      category: ci.product.category ?? null,
      category_id: (ci.product as { category_id?: string }).category_id ?? null,
      name: ci.product.name,
    })),
  });
}

export default function RegisterPage() {
  const pos = usePOS();

  // UI state
  const [activePage, setActivePage] = useState<ActivePage>("register");
  const [showSidebar, setShowSidebar] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState<"open" | "close" | "report" | null>(null);
  const [showReturnsModal, setShowReturnsModal] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showReceipt, setShowReceipt] = useState<Record<string, unknown> | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);

  // Adapt products from Supabase format to POS format (memoized)
  const allProducts = useMemo(() => adaptProducts(pos.products), [pos.products]);

  // Pickup orders → kitchen dockets. When a customer places an order
  // via apps/pickup-native for this outlet, the register auto-prints
  // station-routed kitchen dockets (Bar / Kitchen / Pastry) using the
  // same printer pipeline as in-store orders. Idempotent via the
  // orders.kitchen_docket_printed_at flag so two POS terminals in the
  // same outlet don't double-print. See lib/use-pickup-printer.ts.
  const productsByIdForPrinter = useMemo(
    () => new Map(allProducts.map((p) => [p.id, { id: p.id, kitchen_station: (p as { kitchen_station?: string | null }).kitchen_station ?? null }])),
    [allProducts],
  );
  usePickupPrinter(pos.outlet?.id ?? null, productsByIdForPrinter);

  // Register state
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutQueueNumber, setCheckoutQueueNumber] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");

  // Honor the outlet's configured default order type from
  // pos_branch_settings.default_order_type. Applied once on first load
  // (when branchSettings transitions null → set) so the cashier's
  // manual toggle isn't overridden every re-render.
  const didApplyOrderTypeDefaultRef = useRef(false);
  useEffect(() => {
    if (didApplyOrderTypeDefaultRef.current) return;
    if (!pos.branchSettings) return;
    const cfg = (pos.branchSettings as Record<string, unknown>).default_order_type;
    if (cfg === "dine_in" || cfg === "takeaway") {
      setOrderType(cfg);
    }
    didApplyOrderTypeDefaultRef.current = true;
  }, [pos.branchSettings]);
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
  // Deferred-burn voucher coming from the customer-display second screen.
  // `appliedVoucherId` is an issued_rewards.id that's marked status='used'
  // only after handleCheckoutComplete fires — so a cashier-side void
  // doesn't burn the customer's voucher.
  const [appliedVoucherId, setAppliedVoucherId] = useState<string | null>(null);

  // Pending Spend Beans redemption — customer/cashier tapped a shop
  // reward on the second screen. We display the discount immediately
  // but the actual Beans burn happens at checkout commit (call to
  // /api/loyalty/redeem in handleCheckoutComplete). If the cart is
  // cleared/voided before checkout, no burn — the customer keeps
  // their Beans.
  const [pendingShopRedemption, setPendingShopRedemption] = useState<{
    rewardId: string;
    rewardName: string;
    pointsCost: number;
  } | null>(null);

  // Identified member's top-ordered product IDs (the same data the
  // customer-display "Your usual" strip uses, but consumed here as a
  // category tab). Auto-fetched whenever loyaltyMember changes so the
  // cashier can ring in a regular's usual order in one tap.
  const [memberUsual, setMemberUsual] = useState<string[]>([]);
  useEffect(() => {
    if (!loyaltyMember?.id) {
      setMemberUsual((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/loyalty/snapshot?member_id=${encodeURIComponent(loyaltyMember.id)}`,
        );
        if (!res.ok) return;
        const snap = (await res.json()) as { usual?: Array<{ id: string }> };
        if (cancelled) return;
        setMemberUsual((snap.usual ?? []).map((u) => u.id).filter(Boolean));
      } catch {
        /* silent — Usual tab just won't appear */
      }
    })();
    return () => { cancelled = true; };
  }, [loyaltyMember?.id]);

  // Build tabs based on layout mode (category / tags / custom). Lives
  // here (after loyaltyMember + memberUsual state) so it can include
  // the personalised "Usual" tab when a member is identified.
  const categoryList: ProductCategory[] = useMemo(() => {
    const makeTab = (slug: string, name: string, order: number): ProductCategory => ({
      id: slug, brand_id: "", name, slug, sort_order: order,
      storehub_category_id: null, is_active: true, created_at: "",
    });

    const tabs: ProductCategory[] = [makeTab("all", "All", 0)];

    // Member's usual order — only shows when a loyalty member is
    // identified AND has order history. Sits left of Popular so a
    // regular's go-tos are the cashier's first stop after lookup.
    if (loyaltyMember?.id && memberUsual.length > 0) {
      const first = loyaltyMember.name?.split(" ")[0] ?? "Usual";
      tabs.push(makeTab("usual", `★ ${first}'s Usual`, 0.25));
    }

    if (pos.popularProductIds.length > 0) {
      tabs.push(makeTab("popular", "⭐ Popular", 0.5));
    }

    if (pos.layoutMode === "tags") {
      const tagSet = new Set<string>();
      for (const p of allProducts) { for (const t of (p.tags ?? [])) tagSet.add(t); }
      [...tagSet].sort().forEach((tag, i) => {
        tabs.push(makeTab(`tag:${tag}`, tag.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), i + 1));
      });
    } else if (pos.layoutMode === "custom" && pos.customLayouts.length > 0) {
      pos.customLayouts.forEach((layout, i) => {
        tabs.push(makeTab(`custom:${layout.id}`, layout.name, i + 1));
      });
    } else {
      pos.categories.forEach((cat, i) => {
        tabs.push(makeTab(cat, cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), i + 1));
      });
    }

    return tabs;
  }, [pos.categories, pos.popularProductIds.length, pos.layoutMode, pos.customLayouts, allProducts, loyaltyMember?.id, loyaltyMember?.name, memberUsual.length]);

  // Auto-switch the active category based on the identified member:
  //   • Member identified + has usual items → switch TO "usual" so the
  //     cashier sees their regulars immediately. Saves a tap on every
  //     return-customer order.
  //   • Member cleared (logout / next customer) OR they have no order
  //     history → drop back to "all" so the cashier doesn't stare at
  //     an empty grid.
  // Only fires when memberId actually changes (not on every render),
  // so the cashier's manual tab choices after identification are
  // preserved.
  const lastAutoSwitchMemberIdRef = useRef<string | null>(null);
  useEffect(() => {
    const memberId = loyaltyMember?.id ?? null;
    if (memberId !== lastAutoSwitchMemberIdRef.current) {
      lastAutoSwitchMemberIdRef.current = memberId;
      if (memberId && memberUsual.length > 0) {
        setActiveCategory("usual");
        return;
      }
      if (!memberId) {
        // Member cleared — leave manual tab choice alone unless we
        // were on the now-invalid Usual tab.
        if (activeCategory === "usual") setActiveCategory("all");
        return;
      }
    }
    // Member unchanged but usual just loaded (e.g. snapshot landed
    // after the member was set) — still flip to Usual if we haven't
    // already shown any cart activity. We approximate "no activity"
    // by checking we're on the default "all" tab.
    if (memberId && memberUsual.length > 0 && activeCategory === "all") {
      setActiveCategory("usual");
    }
    // Defensive fallback: if we're stuck on Usual but the data went
    // away, drop to All.
    if (activeCategory === "usual" && (!memberId || memberUsual.length === 0)) {
      setActiveCategory("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loyaltyMember?.id, memberUsual.length]);

  // Auto-evaluate promotions + tier discount on every cart / member /
  // tier / outlet change. Goes through the central loyalty engine via
  // /api/loyalty/evaluate-promotions, which layers the member's tier %
  // discount on top. Debounced 200ms so rapid item-add doesn't hammer
  // the endpoint.
  //
  // Promo codes are NOT supported on the register — they're not a
  // member-rewards concept and were removed at the cashier's request.
  // All member-driven discounts now flow through the Redeem Reward
  // button → RewardPickerModal.
  // Non-stackable tier auto-drop: when a Staff / Black Card member is
  // identified (or the tier flips non-stackable mid-cart somehow), any
  // voucher already on the cart is invalid under native rules. Drop
  // it so the cart total reflects the correct tier-only discount.
  useEffect(() => {
    const t = loyaltyMember?.tier;
    if (t && t.stackable === false && t.discount_percent > 0 && (rewardDiscount > 0 || rewardName)) {
      setRewardDiscount(0);
      setRewardName(null);
      setRewardRedemptionId(null);
      setAppliedVoucherId(null);
      setPendingShopRedemption(null);
      toast.info(`Voucher removed — ${t.name} tier already discounts ${t.discount_percent}%`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loyaltyMember?.tier?.id, loyaltyMember?.tier?.stackable]);

  const [autoPromotions, setAutoPromotions] = useState<AppliedPromotion[]>([]);
  useEffect(() => {
    if (cart.length === 0) {
      setAutoPromotions((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const next = await evaluatePromotions({
        cart,
        memberId:     loyaltyMember?.id ?? null,
        memberTierId: loyaltyMember?.tier?.id ?? null,
        outletId:     pos.outlet?.id ?? null,
        // Tier post-step on the server needs the voucher discount to
        // correctly compute the post-voucher remainder for stackable
        // tiers (Bronze/Silver/Gold/Platinum). Without this, a
        // Platinum member with a Free Drink voucher gets the tier
        // 10% computed on (subtotal - first_order) instead of on
        // (subtotal - first_order - voucher).
        rewardDiscountSen: rewardDiscount,
        signal:       ac.signal,
      });
      setAutoPromotions(next);
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [cart, loyaltyMember?.id, loyaltyMember?.tier?.id, pos.outlet?.id, rewardDiscount]);

  const apiAutoPromoDiscount = autoPromotions.reduce((sum, p) => sum + p.discountAmount, 0);
  const manualPromoDiscount = appliedManualPromo?.discountAmount ?? 0;

  // Local subtotal for the tier-discount safety net below. The
  // canonical `subtotal` is defined further down (depends on cart
  // and is reused for cart totals); we recompute here in sen so
  // the safety-net math doesn't depend on declaration order.
  const subtotalForTier = cart.reduce((sum, i) => sum + i.lineTotal, 0);

  // ── Client-side tier discount safety net ─────────────────
  // The server's /api/loyalty/evaluate-promotions runs the same
  // tier-perk math and folds the % off into autoPromotions for us,
  // but a slow/failed/aborted roundtrip (e.g. between rapid cart
  // edits, network blip, cold start) leaves the cart with no tier
  // discount visible to the cashier — Ammar reported a Black Card
  // member showing full subtotal because the 50% off never landed.
  // To prevent that, we compute the tier discount client-side too.
  // The result is used WHENEVER the server's autoPromotions doesn't
  // already contain a `tier:` line — so there's no double-counting,
  // and when the server responds first the server wins. Stable
  // across reloads since loyaltyMember.tier carries discount_percent
  // + stackable from the lookup.
  //
  // Math mirrors apps/pos/src/app/api/loyalty/evaluate-promotions/
  // route.ts applyTierDiscount() exactly:
  //   • Non-stackable (Staff / Black Card): tier % × raw subtotal
  //   • Stackable (Silver / Gold / Platinum): tier % × (subtotal
  //     - other auto-promos - voucher), floored at 0
  const localTierDiscount = (() => {
    const t = loyaltyMember?.tier;
    if (!t || !t.discount_percent || t.discount_percent <= 0) return 0;
    if (subtotalForTier <= 0) return 0;
    // Skip if the server already returned a tier line — its math
    // includes server-only data (engine-evaluated promos, voucher
    // remainder) and is canonical when present.
    const serverHasTier = autoPromotions.some(
      (p) => p.promotion?.id?.startsWith?.("tier:") ?? false,
    );
    if (serverHasTier) return 0;

    if (t.stackable === false) {
      return Math.round(subtotalForTier * (t.discount_percent / 100));
    }
    const remaining = Math.max(
      0,
      subtotalForTier - apiAutoPromoDiscount - rewardDiscount,
    );
    return Math.round(remaining * (t.discount_percent / 100));
  })();

  const autoPromoDiscount = apiAutoPromoDiscount + localTierDiscount;

  // Auto-show shift modal
  useEffect(() => {
    if (!pos.isShiftOpen) setShowShiftModal("open");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track viewport width so the product grid can pick a sensible default
  // column count for the hardware in use. Default 5 on the legacy 1280×800
  // SUNMI panels, 6 on the D3's 15.6" 1920×1080 main display (otherwise
  // 5 columns × ~312px tiles wastes most of the extra real estate).
  // Outlets that have set pos_branch_settings.grid_columns keep their
  // explicit value.
  //
  // The register layout pins the page inside a fixed 1920×1080 frame
  // (see app/register/layout.tsx) so desktop preview matches the
  // SUNMI exactly. Resolve viewport width against `.pos-frame` when
  // present so the grid column heuristic uses the frame width (1920)
  // instead of whatever the actual browser window is. Falls back to
  // window.innerWidth on the device, where there is no frame because
  // the frame fills the entire screen.
  const readFrameWidth = () => {
    if (typeof window === "undefined") return 1920;
    const frame = document.querySelector(".pos-frame") as HTMLElement | null;
    return frame?.clientWidth ?? window.innerWidth;
  };
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1920 : readFrameWidth(),
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(readFrameWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const defaultGridColumns = viewportWidth >= 1600 ? 6 : 5;

  const filteredProducts = useMemo(() => {
    let products = [...allProducts];

    if (activeCategory === "usual") {
      // Preserve memberUsual ordering (snapshot returns by frequency,
      // most-ordered first) — Map lookup + filter drops products that
      // aren't on the current menu (e.g. discontinued items).
      const byId = new Map(allProducts.map((p) => [p.id, p]));
      products = memberUsual
        .map((id) => byId.get(id))
        .filter((p): p is Product => !!p);
    } else if (activeCategory === "popular") {
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
  }, [allProducts, activeCategory, search, pos.popularProductIds, pos.customLayouts, memberUsual]);

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
    setAppliedVoucherId(null);
    setPendingShopRedemption(null);  // discard any unburned Spend Beans
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
        productId: i.product.id,
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
      // showCheckout flips us into "payment" mode — customer-display
      // takes over with a full-screen Scan-to-Pay view. Empty cart =
      // "idle" no matter what (no checkout possible). After the
      // modal closes we revert to "ordering" naturally.
      status: cart.length === 0
        ? "idle"
        : showCheckout
          ? "payment"
          : "ordering",
      member: loyaltyMember
        ? {
            id: loyaltyMember.id,
            name: loyaltyMember.name,
            phone: loyaltyMember.phone,
            points_balance: loyaltyMember.points_balance,
          }
        : null,
      appliedVoucher:
        rewardName && rewardDiscount > 0
          ? {
              id: appliedVoucherId ?? rewardRedemptionId ?? "",
              name: rewardName,
              discount_sen: rewardDiscount,
            }
          : null,
      // Server-returned promos + the client-side tier safety net
      // (when the server didn't include one). The customer-display
      // shows each as a labelled discount line.
      autoPromotions: [
        ...autoPromotions.map((p) => ({
          id: p.promotion.id,
          name: p.description,
          discount_sen: p.discountAmount,
        })),
        ...(localTierDiscount > 0 && loyaltyMember?.tier
          ? [{
              id: `tier:${loyaltyMember.tier.id}`,
              name: `${loyaltyMember.tier.name} — ${loyaltyMember.tier.discount_percent}% off`,
              discount_sen: localTierDiscount,
            }]
          : []),
      ],
    });
  }, [
    cart,
    subtotal,
    serviceCharge,
    totalDiscount,
    total,
    pos.outlet?.id,
    pos.outlet?.name,
    loyaltyMember,
    rewardName,
    rewardDiscount,
    appliedVoucherId,
    rewardRedemptionId,
    showCheckout,
    autoPromotions,
    localTierDiscount,
    // appliedManualPromo affects totalDiscount (via manualPromoDiscount
    // → autoPromoDiscount-adjacent math) but its reference was missing
    // from this dep array, so when the cashier applied a manual
    // discount via DiscountModal the register's `total` updated but
    // no re-broadcast fired. The customer-display kept showing the
    // pre-discount total, and the Maybank QR encoded the wrong amount
    // — customer scanned and paid full price on a discounted order.
    appliedManualPromo,
    discount,
  ]);

  // ─── Inbound messages from customer-display ───────────────
  // Register the listener exactly ONCE on mount. BroadcastChannel
  // doesn't queue messages across listener teardowns, so re-registering
  // on every cart change (the previous behavior, when deps included
  // subtotal / allProducts / pos.isShiftOpen) silently dropped any
  // memberSelected / applyVoucher / applyShopReward / addToCart
  // message that arrived in the cleanup-recreate gap — which is most
  // of them, because the gap fires every time a cart line ticks.
  //
  // Latest values are read via refs so the handler stays current
  // without forcing a re-subscribe.
  const subtotalRef = useRef(0);
  const allProductsRef = useRef<typeof allProducts>([]);
  const isShiftOpenRef = useRef(false);
  const cartRef = useRef<CartItem[]>([]);
  const loyaltyMemberRef = useRef<LoyaltyMember | null>(null);
  useEffect(() => { subtotalRef.current = subtotal; }, [subtotal]);
  useEffect(() => { allProductsRef.current = allProducts; }, [allProducts]);
  useEffect(() => { isShiftOpenRef.current = pos.isShiftOpen; }, [pos.isShiftOpen]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { loyaltyMemberRef.current = loyaltyMember; }, [loyaltyMember]);
  useEffect(() => {
    return listenToRegisterInbox((msg) => {
      const currentSubtotal = subtotalRef.current;
      const currentProducts = allProductsRef.current;
      const currentShiftOpen = isShiftOpenRef.current;
      const currentMember = loyaltyMemberRef.current;
      // Native tier rule: when a member is on a non-stackable tier
      // (Staff / Black Card), their tier % off REPLACES voucher
      // discounts entirely. Block any voucher-apply attempt here and
      // tell the cashier why — silently swallowing the request would
      // leave them confused as to why the cart didn't change.
      const blockVoucherForNonStackable = (label: string) => {
        const tier = currentMember?.tier;
        if (tier && tier.stackable === false && tier.discount_percent > 0) {
          toast.error(
            `${tier.name} tier already gives ${tier.discount_percent}% off — vouchers can't stack`,
          );
          return true;
        }
        return false;
      };
      if (msg.type === "memberSelected") {
        // Adopt the member the customer just identified via the second screen.
        // Shape matches LoyaltyMember exactly so existing UI keeps working.
        setLoyaltyMember({
          id: msg.member.id,
          phone: msg.member.phone,
          name: msg.member.name,
          tags: msg.member.tags,
          points_balance: msg.member.points_balance,
          total_spent: msg.member.total_spent,
          total_visits: msg.member.total_visits,
          last_visit_at: msg.member.last_visit_at,
          tier: msg.member.tier ?? null,
        });
        setCustomerPhone(msg.member.phone);
      } else if (msg.type === "memberCleared") {
        // Only clear the member identity, not the cart.
        setLoyaltyMember(null);
        setCustomerPhone("");
      } else if (msg.type === "applyVoucher") {
        if (blockVoucherForNonStackable(msg.voucherName)) return;
        const result = applyDescriptorToCart(msg.discount, cartRef.current);
        const discountSen = Math.min(result.discount_sen, Math.max(0, currentSubtotal));
        if (msg.discount.type === "free_item" && discountSen === 0) {
          // Free-item voucher applied without a qualifying line in the
          // cart. Tell the cashier so they can swap items or skip the
          // voucher. Previously this path silently zero'd or — worse —
          // pulled the price from the catalog (ignoring whether the
          // qualifying item was actually in the customer's basket).
          // The shared engine + cart-walk makes voucher application
          // honest: no qualifying line, no discount.
          toast.error(
            `${msg.voucherName} needs ${
              msg.discount.applicable_categories?.length ? "a qualifying drink" : "a qualifying item"
            } in the cart`,
          );
          return;
        }
        setRewardDiscount(discountSen);
        setRewardName(msg.voucherName);
        setRewardRedemptionId(null); // not a /redeem flow
        setAppliedVoucherId(msg.voucherId);
        toast.success(`Voucher applied: ${msg.voucherName}`);
      } else if (msg.type === "applyShopReward") {
        if (blockVoucherForNonStackable(msg.rewardName)) return;
        // Customer tapped a Spend Beans tile on the second screen.
        // Apply the discount to the cart immediately; record the
        // redemption as pending so handleCheckoutComplete burns the
        // Beans only when the order actually commits.
        const result = applyDescriptorToCart(msg.discount, cartRef.current);
        const discountSen = Math.min(result.discount_sen, Math.max(0, currentSubtotal));
        if (msg.discount.type === "free_item" && discountSen === 0) {
          // Customer tapped Free Drink but nothing in cart qualifies.
          // Don't silently set a 0 discount — surface a clear toast so
          // the cashier can swap items or skip the reward.
          toast.error(
            `${msg.rewardName} needs ${
              msg.discount.applicable_categories?.length ? "a qualifying drink" : "a qualifying item"
            } in the cart`,
          );
          return;
        }
        setRewardDiscount(discountSen);
        setRewardName(msg.rewardName);
        setAppliedVoucherId(null);   // not a wallet voucher
        setRewardRedemptionId(null); // burn happens at checkout
        setPendingShopRedemption({
          rewardId:   msg.rewardId,
          rewardName: msg.rewardName,
          pointsCost: msg.pointsCost,
        });
        toast.success(`${msg.rewardName} reserved — ${msg.pointsCost} Beans on checkout`);
      } else if (msg.type === "addToCart") {
        // Customer tapped a tile in the "Your usual" strip on the
        // second display. Resolve the product against our live catalog
        // and route through the same handler the product grid uses, so
        // mandatory-modifier products still trigger the modal.
        const product = currentProducts.find((p) => p.id === msg.productId);
        if (!product) {
          toast.error(`"${msg.productName}" not on this menu`);
          return;
        }
        if (!currentShiftOpen) {
          toast.error("Open a shift before ringing in items");
          return;
        }
        if (product.modifiers.length > 0) {
          // Surface the modal so cashier confirms cup size / milk / etc.
          setModifierProduct(product);
          toast.info(`${product.name} — confirm options`);
        } else {
          addToCart(product, []);
          toast.success(`Added: ${product.name}`);
        }
      }
    });
    // Empty deps — listener registered once, latest values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Pipe each applied promo's name to the order record so the
        // receipt + reports can show what saved the customer money
        // ("Black Card — 50% off, Happy Hour — 10% off"). Comma-joined
        // when multiple promos stack.
        promoName: autoPromotions.length
          ? autoPromotions.map((p) => p.description).join(", ")
          : (appliedManualPromo?.description ?? null),
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
      // If any cart line carries print_additional_docket, we need to
      // print the kitchen docket twice — used for items that the line
      // staff splits (e.g. beer packages, set meals).
      const needsExtraDocket = cart.some((i) => (i.product as { print_additional_docket?: boolean }).print_additional_docket === true);
      setTimeout(async () => {
        try {
          await printKitchenDocket80mm(order, outletInfo);
          if (needsExtraDocket) {
            await printKitchenDocket80mm(order, outletInfo);
          }
        } catch (e) {
          console.error("[PRINT] Kitchen docket failed:", e);
        }
        try {
          await printReceipt80mm(order, outletInfo, receiptConfig);
        } catch (e) {
          console.error("[PRINT] Receipt failed:", e);
        }
      }, 300);
      clearCart();
    } catch (err) {
      console.error("Send to kitchen failed:", err);
      toast.error("Failed to send order. Please try again.");
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
        // Pipe each applied promo's name to the order record so the
        // receipt + reports can show what saved the customer money
        // ("Black Card — 50% off, Happy Hour — 10% off"). Comma-joined
        // when multiple promos stack.
        promoName: autoPromotions.length
          ? autoPromotions.map((p) => p.description).join(", ")
          : (appliedManualPromo?.description ?? null),
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
        // Persist the burned wallet-voucher id so a refund can re-activate it
        // (the /mark-used burn below otherwise leaves no link on the order).
        loyaltyVoucherId: appliedVoucherId,
      });

      // ── Loyalty post-processing — TRULY fire-and-forget ────
      // All four calls below were previously `await fetch(...)`,
      // which made the "Payment Successful" modal sit for however
      // long the slowest endpoint took to respond. If any one
      // hung (cold start, mission service blip, rate-limit retry)
      // the cashier saw a frozen UI on a paid order. The order is
      // already committed at this point — none of these calls
      // affect the receipt, the cart, or the customer's payment
      // confirmation, so they MUST not gate the UI.
      //
      // Pattern: build the request body, fire `void fetch(...)`
      // with a .catch() to swallow errors. No awaits. The browser
      // happily holds the in-flight request even after the modal
      // closes and the cart clears — typically completing in
      // ~200ms in the background.
      if (loyaltyMember && total > 0 && pos.outlet) {
        void fetch("/api/loyalty/earn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: loyaltyMember.id,
            outlet_id: pos.outlet.id,
            amount_rm: total / 100, // sen → RM
            order_id: order.id,
            order_number: order.order_number,
          }),
        }).catch((e) => console.error("[LOYALTY] Points earning failed:", e));
      }

      // Customer-display deferred-burn voucher: flip status='used' now
      // that the order is actually paid. The /redeem path burns at apply
      // time; the apply-voucher path doesn't, so we owe the burn here.
      if (appliedVoucherId && loyaltyMember) {
        void fetch("/api/loyalty/mark-used", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: loyaltyMember.id,
            voucher_id: appliedVoucherId,
          }),
        }).catch((e) => console.error("[LOYALTY] mark-used failed:", e));
      }

      // Deferred Spend Beans burn — the customer tapped a "Spend X
      // Beans" tile on the second screen which only applied the
      // discount; the actual point deduction (and redemption record)
      // happens here so a voided cart doesn't burn the customer's
      // Beans.
      if (pendingShopRedemption && loyaltyMember) {
        void fetch("/api/loyalty/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: loyaltyMember.id,
            reward_id: pendingShopRedemption.rewardId,
            outlet_id: pos.outlet?.id ?? "",
          }),
        }).catch((e) => console.error("[LOYALTY] pending Spend Beans burn failed:", e));
      }

      // Mission / challenge progress — POS orders advance challenges
      // the same way pickup orders do, via the same goal evaluator
      // (ported into apps/pos/src/app/api/loyalty/apply-order-to-mission).
      // Without this call, RM50 Bill / Weekend Run / Make it a Meal
      // stay at 0/X forever for in-store members.
      if (loyaltyMember && pos.outlet?.id) {
        void fetch("/api/loyalty/apply-order-to-mission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member_id: loyaltyMember.id,
            order: {
              id: order.id,
              outlet_id: pos.outlet.id,
              items: cart.map((i) => ({
                product_id: i.product.id,
                category: i.product.category ?? null,
                quantity: i.quantity,
              })),
              item_count: cart.reduce((s, i) => s + i.quantity, 0),
              total_sen: total,
              created_at: new Date().toISOString(),
            },
          }),
        }).catch((e) => console.error("[LOYALTY] mission tick failed:", e));
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
      const needsExtraDocket2 = cart.some((i) => (i.product as { print_additional_docket?: boolean }).print_additional_docket === true);
      setTimeout(async () => {
        try {
          await printKitchenDocket80mm(order, outletInfo);
          if (needsExtraDocket2) {
            await printKitchenDocket80mm(order, outletInfo);
          }
        } catch (e) {
          console.error("[PRINT] Kitchen docket failed:", e);
        }
        try {
          await printReceipt80mm(order, outletInfo, receiptConfig);
        } catch (e) {
          console.error("[PRINT] Receipt failed:", e);
        }
        setShowReceipt(order as unknown as Record<string, unknown>);
      }, 300);
    } catch (err) {
      console.error("Order creation failed:", err);
      toast.error("Failed to create order. Please try again.");
      // CRITICAL: clear any pending Spend Beans / voucher state so it
      // doesn't leak into the NEXT order. Previously these stayed set
      // when order creation threw — the cashier would retry or move on
      // to the next customer, and on that customer's successful order
      // the prior customer's Beans got burned. Voucher applied state
      // had the same risk. Closing the checkout modal too so the
      // cashier can adjust + retry without a stuck overlay.
      setPendingShopRedemption(null);
      setRewardDiscount(0);
      setRewardName(null);
      setRewardRedemptionId(null);
      setAppliedVoucherId(null);
      setShowCheckout(false);
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
              <ClipboardList className="h-4 w-4" />
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
                columns={(pos.branchSettings as any)?.grid_columns ?? defaultGridColumns}
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
          {/* Order header — brand-aligned with customer-display (Peachi
              title + Space Grotesk eyebrow). */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2
                className="text-lg"
                style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
              >
                {editingOrderId ? "Edit Order" : "Current Order"}
              </h2>
              <span
                className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
              >
                {orderType === "dine_in" ? "Dine-in" : "Takeaway"}
                {tableNumber && ` · Table ${tableNumber}`}
                {customerPhone && ` · ${customerPhone}`}
                {" · "}{itemCount} item{itemCount !== 1 ? "s" : ""}
              </span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-[10px] font-bold uppercase tracking-[0.14em] text-danger hover:underline"
                style={{ fontFamily: "Space Grotesk" }}
              >
                Clear All
              </button>
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
              {loyaltyMember === null && customerPhone.length >= 10 && !memberLoading && (
                <p className="mt-1.5 text-xs text-text-dim">Press Enter or Lookup to find member</p>
              )}
            </div>
          )}

          {/* Member identity card — lives OUTSIDE the lookup form so
              the cashier sees the customer's name + tier + Beans even
              after closing the lookup panel. Previously this card was
              nested inside {showCustomerLookup && …} which made the
              entire member identity vanish the moment the lookup form
              collapsed, even though `loyaltyMember` was still set in
              state (and the broadcast still going out to the second
              screen). */}
          {loyaltyMember && (() => {
            const tierColor = loyaltyMember.tier?.color ?? "#FBBF24";
            const tierName = loyaltyMember.tier?.name ?? "Member";
            const tierMul = loyaltyMember.tier?.multiplier ?? 1;
            return (
              <div
                className="mx-4 mt-2 overflow-hidden rounded-lg border"
                style={{
                  borderColor: `${tierColor}40`,
                  backgroundColor: "rgba(251,191,36,0.06)",
                }}
              >
                <div className="h-0.5" style={{ backgroundColor: tierColor }} />
                <div className="px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p
                          className="truncate text-sm"
                          style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
                        >
                          {loyaltyMember.name ?? "Member"}
                        </p>
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white"
                          style={{ backgroundColor: tierColor, fontFamily: "Space Grotesk" }}
                        >
                          {tierName}{tierMul > 1 ? ` · ${tierMul}×` : ""}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 truncate text-[10px]"
                        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.55)" }}
                      >
                        {loyaltyMember.phone}
                        {loyaltyMember.total_visits > 0 && ` · ${loyaltyMember.total_visits} visits`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className="text-base leading-none"
                        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
                      >
                        {loyaltyMember.points_balance.toLocaleString()}
                      </p>
                      <p
                        className="mt-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em]"
                        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.6)" }}
                      >
                        Beans
                      </p>
                    </div>
                  </div>

                  {/* Active reward chip — small inline status when
                      something's been redeemed. Tap × to drop. */}
                  {rewardName && (
                    <div className="mt-1.5 flex items-center justify-between rounded bg-success/10 px-2 py-1">
                      <span className="truncate text-[10px] font-medium text-success">
                        ✓ {rewardName}
                      </span>
                      <button
                        onClick={() => { setRewardDiscount(0); setRewardName(null); setRewardRedemptionId(null); setAppliedVoucherId(null); setPendingShopRedemption(null); }}
                        className="ml-1.5 text-[10px] text-danger hover:underline"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
                          <p
                            className="truncate text-sm"
                            style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0" }}
                          >
                            {item.product.name}
                          </p>
                          {item.selectedModifiers.length > 0 && (
                            <p
                              className="truncate text-xs"
                              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
                            >
                              {item.selectedModifiers.map((m) => m.option.name).join(", ")}
                            </p>
                          )}
                        </div>
                        <span
                          className="whitespace-nowrap text-sm"
                          style={{ fontFamily: "Space Grotesk", fontWeight: 600, color: "rgba(245,243,240,0.85)" }}
                        >
                          {displayRM(item.lineTotal)}
                        </span>
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
            {/* Promotion indicators — also surfaces the identified
                member's available rewards as tappable rows so the
                cashier doesn't need to open a separate Redeem modal. */}
            <PromoIndicator
              autoPromotions={autoPromotions}
              cart={cart}
              appliedManualPromo={appliedManualPromo}
              onRemoveManual={() => setAppliedManualPromo(null)}
              memberId={loyaltyMember?.id ?? null}
              onOpenRewards={() => setShowRewardPicker(true)}
            />

            <div className="mb-3 space-y-1.5 text-sm" style={{ fontFamily: "Space Grotesk" }}>
              {/* Tap subtotal to add order discount */}
              <button
                className="flex w-full justify-between hover:text-brand"
                onClick={() => { setShowOrderDiscount(!showOrderDiscount); setInlineDiscountValue(""); setInlineDiscountType("percent"); }}
              >
                <span className="text-text-muted">Subtotal {cart.length > 0 && !discount ? "(tap to discount)" : ""}</span>
                <span className="text-text">{displayRM(subtotal)}</span>
              </button>
              {serviceCharge > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Service Charge</span>
                  <span className="text-text">{displayRM(serviceCharge)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-success">Discount</span>
                  <button className="text-success hover:underline" onClick={() => setDiscount(0)}>-{displayRM(discount)} ✕</button>
                </div>
              )}
              {promoDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Promo</span>
                  <span className="text-success">-{displayRM(promoDiscount)}</span>
                </div>
              )}
              {rewardDiscount > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "#FBBF24" }}>Reward: {rewardName}</span>
                  <button
                    style={{ color: "#FBBF24" }}
                    className="hover:underline"
                    onClick={() => { setRewardDiscount(0); setRewardName(null); setRewardRedemptionId(null); setAppliedVoucherId(null); setPendingShopRedemption(null); }}
                  >
                    -{displayRM(rewardDiscount)} ✕
                  </button>
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

              <div
                className="flex justify-between pt-2 border-t border-border text-2xl"
                style={{ fontFamily: "Peachi", fontWeight: 700 }}
              >
                <span style={{ color: "#F5F3F0" }}>Total</span>
                <span style={{ color: "#FBBF24" }}>{displayRM(total)}</span>
              </div>
            </div>

            {/* Pay first → then kitchen prints (for all order types) */}
            <button disabled={cart.length === 0} onClick={() => handleOpenCheckout()} className="w-full rounded-xl bg-brand py-3.5 text-base font-bold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
              {cart.length === 0 ? "Add items to charge" : `Charge ${displayRM(total)}`}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showSidebar && <POSSidebar isOpen={showSidebar} onClose={() => setShowSidebar(false)} onNavigate={(p) => {
        // "returns" is a modal, not a page — sidebar uses the same
        // onNavigate API for everything, so we fork it here.
        if (p === "returns") { setShowReturnsModal(true); return; }
        setActivePage(p as ActivePage);
      }} activePage={activePage} />}
      {showReturnsModal && <ReturnsModal onClose={() => setShowReturnsModal(false)} />}
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
            printReceipt80mm(showReceipt, {
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
            // Native rule: non-stackable tiers (Staff / Black Card)
            // replace voucher discounts entirely. Block the redemption
            // up front instead of silently swallowing it.
            const t = loyaltyMember?.tier;
            if (t && t.stackable === false && t.discount_percent > 0) {
              toast.error(
                `${t.name} tier already gives ${t.discount_percent}% off — vouchers can't stack`,
              );
              setShowRewardPicker(false);
              return;
            }
            // Discount math goes through @celsius/shared so this
            // modal path (cashier-side picker) lands the same
            // discount as the customer-display flow (applyVoucher /
            // applyShopReward) AND as Pickup's server-side checkout.
            const engineResult = applyDescriptorToCart(result.discount, cart);
            const discountSen = Math.min(engineResult.discount_sen, subtotal);
            if (result.discount.type === "free_item" && discountSen === 0) {
              toast.error(
                `${result.reward_name} needs ${
                  result.discount.applicable_categories?.length ? "a qualifying drink" : "a qualifying item"
                } in the cart`,
              );
              setShowRewardPicker(false);
              return;
            }
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
