"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as db from "./supabase-queries";
import type { CartItem } from "@/types/database";

// ─── Types (matching Supabase table shapes) ────────────────

export type Staff = {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_hash: string;
  brand_id: string;
  outlet_id: string | null;
  is_active: boolean;
};

export type Outlet = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  storehub_store_id: string | null;
};

export type Register = {
  id: string;
  outlet_id: string;
  name: string;
  is_active: boolean;
};

export type Shift = {
  id: string;
  outlet_id: string;
  register_id: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  total_sales: number;
  total_orders: number;
  total_refunds: number;
};

export type DBOrder = {
  id: string;
  order_number: string;
  outlet_id: string;
  register_id: string;
  shift_id: string;
  employee_id: string;
  source: string;
  order_type: string;
  status: string;
  table_number: string | null;
  queue_number: string | null;
  subtotal: number;
  service_charge: number;
  discount_amount: number;
  promo_discount: number;
  promo_name: string | null;
  total: number;
  customer_phone: string | null;
  customer_name: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  pos_order_items?: DBOrderItem[];
  pos_order_payments?: DBOrderPayment[];
};

export type DBOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  modifiers: unknown;
  modifier_total: number;
  item_total: number;
  notes: string | null;
  kitchen_station: string | null;
  kitchen_status: string;
};

export type DBOrderPayment = {
  id: string;
  order_id: string;
  payment_method: string;
  amount: number;
  status: string;
};

// ─── Context type ──────────────────────────────────────────

type POSContextType = {
  // Auth
  staff: Staff | null;
  outlet: Outlet | null;
  register: Register | null;
  login: (staff: Staff) => void;
  logout: () => void;
  allStaff: Staff[];

  // Outlet selection
  outlets: Outlet[];
  selectOutlet: (outlet: Outlet) => void;

  // Shift
  currentShift: Shift | null;
  openShift: () => Promise<void>;
  closeShift: () => Promise<void>;
  isShiftOpen: boolean;

  // Products
  products: Record<string, unknown>[];
  categories: string[];
  popularProductIds: string[];
  layoutMode: string; // 'category' | 'tags' | 'custom'
  customLayouts: { id: string; name: string; product_ids: string[]; include_categories: string[]; include_tags: string[]; color: string; sort_order: number }[];
  loadProducts: () => Promise<void>;

  // Orders
  openOrders: DBOrder[];
  completedOrders: DBOrder[];
  loadOrders: () => Promise<void>;
  createPOSOrder: (params: {
    orderType: string;
    tableNumber: string | null;
    queueNumber: string | null;
    cart: CartItem[];
    subtotal: number;
    serviceCharge: number;
    discount: number;
    promoDiscount: number;
    promoName: string | null;
    total: number;
    customerPhone: string | null;
    customerName: string | null;
    notes: string | null;
    paymentMethod: string;
    status: string;
    loyaltyPhone?: string | null;
    rewardId?: string | null;
    rewardName?: string | null;
    rewardDiscount?: number;
  }) => Promise<DBOrder>;
  voidOrder: (orderId: string, reason: string) => Promise<void>;

  // Queue
  nextQueueNumber: () => Promise<string>;

  // Settings
  serviceChargeRate: number;
  branchSettings: Record<string, unknown> | null;

  // Loading
  isLoading: boolean;
};

const POSContext = createContext<POSContextType | null>(null);

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error("usePOS must be used within POSProvider");
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────

export function POSProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("pos_staff");
      if (saved) try { return JSON.parse(saved) as Staff; } catch {}
    }
    return null;
  });
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [register, setRegister] = useState<Register | null>(null);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [popularProductIds, setPopularProductIds] = useState<string[]>([]);
  const [customLayouts, setCustomLayouts] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<DBOrder[]>([]);
  const [completedOrders, setCompletedOrders] = useState<DBOrder[]>([]);
  const [branchSettings, setBranchSettings] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [orderSeq, setOrderSeq] = useState(1);

  // Load initial data
  useEffect(() => {
    async function init() {
      try {
        const [outletData, staffData] = await Promise.all([
          db.fetchOutlets(),
          db.fetchAllStaff(),
        ]);
        setOutlets(outletData as Outlet[]);
        setAllStaff(staffData as Staff[]);

        // Default to first outlet
        if (outletData.length > 0) {
          const defaultOutlet = outletData[0] as Outlet;
          setOutlet(defaultOutlet);

          const [regs, settings, prods, cats, popular, layouts] = await Promise.all([
            db.fetchRegisters(defaultOutlet.id),
            db.fetchBranchSettings(defaultOutlet.id).catch(() => null),
            db.fetchProducts(),
            db.fetchCategories(),
            db.fetchPopularProductIds(12),
            db.fetchRegisterLayouts(defaultOutlet.id),
          ]);

          if (regs.length > 0) setRegister(regs[0] as Register);
          setBranchSettings(settings as Record<string, unknown> | null);
          setProducts(prods as Record<string, unknown>[]);
          setCategories(cats as string[]);
          setPopularProductIds(popular as string[]);
          setCustomLayouts(layouts as any[]);

          // Initialize order sequence from existing orders
          const maxSeq = await db.fetchMaxOrderSeq(defaultOutlet.id);
          setOrderSeq(maxSeq + 1);

          // Check for active shift (parallel with state updates above)
          if (regs.length > 0) {
            const activeShift = await db.fetchActiveShift(defaultOutlet.id, regs[0].id);
            if (activeShift) {
              setCurrentShift(activeShift as Shift);
              const orders = await db.fetchOrdersByShift(activeShift.id);
              const open: DBOrder[] = [];
              const completed: DBOrder[] = [];
              for (const o of orders as DBOrder[]) {
                if (o.status === "open" || o.status === "sent_to_kitchen") open.push(o);
                else if (o.status === "completed" || o.status === "cancelled") completed.push(o);
              }
              setOpenOrders(open);
              setCompletedOrders(completed);
            }
          }
        }
      } catch (err: unknown) {
        console.error("[POS] Init error:", err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const login = useCallback((s: Staff) => {
    setStaff(s);
    sessionStorage.setItem("pos_staff", JSON.stringify(s));
  }, []);
  const logout = useCallback(async () => {
    setStaff(null);
    setCurrentShift(null);
    sessionStorage.removeItem("pos_staff");
    // Clear server-side session cookie
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    window.location.href = "/login";
  }, []);

  const selectOutlet = useCallback(async (o: Outlet) => {
    setOutlet(o);
    const [regs, settings] = await Promise.all([
      db.fetchRegisters(o.id),
      db.fetchBranchSettings(o.id).catch(() => null),
    ]);
    if (regs.length > 0) setRegister(regs[0] as Register);
    setBranchSettings(settings as Record<string, unknown> | null);
  }, []);

  const openShiftFn = useCallback(async () => {
    if (!outlet) { console.error("[POS] Cannot open shift: no outlet"); return; }
    if (!staff) { console.error("[POS] Cannot open shift: no staff"); return; }

    // If no register, create a default one
    let reg = register;
    if (!reg) {
      console.warn("[POS] No register found, creating default");
      const { data } = await (await import("./supabase-browser")).createClient()
        .from("pos_registers")
        .upsert({ id: `reg-${outlet.id}-1`, outlet_id: outlet.id, name: "Register 1", is_active: true }, { onConflict: "id" })
        .select()
        .single();
      if (data) {
        reg = data as Register;
        setRegister(reg);
      } else {
        console.error("[POS] Failed to create register");
        return;
      }
    }

    try {
      const shift = await db.openShift(outlet.id, reg.id, staff.id);
      setCurrentShift(shift as Shift);
      setOpenOrders([]);
      setCompletedOrders([]);
      setOrderSeq(1);
    } catch (err) {
      console.error("[POS] openShift error:", err);
      alert("Failed to open shift. Please try again.");
    }
  }, [outlet, register, staff]);

  const closeShiftFn = useCallback(async () => {
    if (!currentShift || !staff) return;
    const totalSales = completedOrders.filter((o) => o.status === "completed").reduce((s, o) => s + o.total, 0);
    const totalRefunds = completedOrders.filter((o) => o.status === "cancelled").reduce((s, o) => s + o.total, 0);
    const shift = await db.closeShift(
      currentShift.id, staff.id, totalSales,
      completedOrders.filter((o) => o.status === "completed").length, totalRefunds
    );
    setCurrentShift(shift as Shift);
    // Reset queue counter
    if (outlet) {
      // Queue counter resets handled by branch_settings
    }
  }, [currentShift, staff, completedOrders, outlet]);

  const loadProducts = useCallback(async () => {
    const [prods, cats] = await Promise.all([db.fetchProducts(), db.fetchCategories()]);
    setProducts(prods as Record<string, unknown>[]);
    setCategories(cats as string[]);
  }, []);

  const loadOrders = useCallback(async () => {
    if (!currentShift) return;
    const orders = await db.fetchOrdersByShift(currentShift.id);
    const open = (orders as DBOrder[]).filter((o) => o.status === "open" || o.status === "sent_to_kitchen");
    const completed = (orders as DBOrder[]).filter((o) => o.status === "completed" || o.status === "cancelled");
    setOpenOrders(open);
    setCompletedOrders(completed);
  }, [currentShift]);

  const createPOSOrder = useCallback(async (params: {
    orderType: string;
    tableNumber: string | null;
    queueNumber: string | null;
    cart: CartItem[];
    subtotal: number;
    serviceCharge: number;
    discount: number;
    promoDiscount: number;
    promoName: string | null;
    total: number;
    customerPhone: string | null;
    customerName: string | null;
    notes: string | null;
    paymentMethod: string;
    status: string;
    loyaltyPhone?: string | null;
    rewardId?: string | null;
    rewardName?: string | null;
    rewardDiscount?: number;
  }) => {
    if (!outlet || !register || !currentShift || !staff) throw new Error("No active session");

    // Get next order number from DB to avoid duplicates
    const maxSeq = await db.fetchMaxOrderSeq(outlet.id);
    const nextSeq = maxSeq + 1;
    const outletCode = outlet.name.substring(0, 3).toUpperCase();
    const orderNumber = `CC-${outletCode}-${String(nextSeq).padStart(4, "0")}`;
    setOrderSeq(nextSeq + 1);

    // Create order
    const order = await db.createOrder({
      order_number: orderNumber,
      outlet_id: outlet.id,
      register_id: register.id,
      shift_id: currentShift.id,
      employee_id: staff.id,
      order_type: params.orderType,
      status: params.status,
      table_number: params.tableNumber,
      queue_number: params.queueNumber,
      subtotal: params.subtotal,
      service_charge: params.serviceCharge,
      discount_amount: params.discount,
      promo_discount: params.promoDiscount,
      promo_name: params.promoName,
      total: params.total,
      customer_phone: params.customerPhone,
      customer_name: params.customerName,
      loyalty_phone: params.loyaltyPhone ?? null,
      reward_id: params.rewardId ?? null,
      reward_name: params.rewardName ?? null,
      reward_discount_amount: params.rewardDiscount ?? 0,
      notes: params.notes,
    });

    // Create order items
    const items = params.cart.map((item) => ({
      order_id: order.id,
      product_id: item.product.id ?? (item.product as Record<string, unknown>).id as string,
      product_name: item.product.name ?? (item.product as Record<string, unknown>).name as string,
      variant_name: item.variant?.name ?? null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      modifiers: item.selectedModifiers,
      modifier_total: item.modifierTotal,
      item_total: item.lineTotal,
      notes: item.notes || null,
      kitchen_station: (item.product as Record<string, unknown>).kitchen_station as string | null ?? null,
      kitchen_status: "pending",
    }));
    await db.createOrderItems(items);

    // Create payment if completed
    if (params.status === "completed" && params.paymentMethod) {
      await db.createOrderPayment({
        order_id: order.id,
        payment_method: params.paymentMethod,
        amount: params.total,
        status: "completed",
      });
    }

    // Reload orders
    await loadOrders();

    // Return order with items attached (needed for printing)
    return { ...order, pos_order_items: items, pos_order_payments: params.status === "completed" ? [{ payment_method: params.paymentMethod, amount: params.total }] : [] } as DBOrder;
  }, [outlet, register, currentShift, staff, orderSeq, loadOrders]);

  const voidOrderFn = useCallback(async (orderId: string, reason: string) => {
    await db.updateOrderStatus(orderId, "cancelled", { cancellation_reason: reason });
    await loadOrders();
  }, [loadOrders]);

  const nextQueueNumberFn = useCallback(async () => {
    if (!outlet) return "TA-0000";
    return db.getNextQueueNumber(outlet.id);
  }, [outlet]);

  const serviceChargeRate = (branchSettings as Record<string, number> | null)?.service_charge_rate ?? 0;

  return (
    <POSContext.Provider
      value={{
        staff, outlet, register, login, logout, allStaff,
        outlets, selectOutlet,
        currentShift, openShift: openShiftFn, closeShift: closeShiftFn,
        isShiftOpen: currentShift !== null && currentShift.closed_at === null,
        products, categories, popularProductIds,
        layoutMode: (branchSettings as any)?.layout_mode ?? "category",
        customLayouts,
        loadProducts,
        openOrders, completedOrders, loadOrders,
        createPOSOrder, voidOrder: voidOrderFn,
        nextQueueNumber: nextQueueNumberFn,
        serviceChargeRate, branchSettings,
        isLoading,
      }}
    >
      {children}
    </POSContext.Provider>
  );
}
