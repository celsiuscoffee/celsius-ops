import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, Product, CartItemModifiers, Store } from "@/lib/types";

function generateCartItemId() {
  return Math.random().toString(36).substring(2, 9);
}

function calculateItemPrice(
  product: Product,
  modifiers: CartItemModifiers,
  quantity: number
): number {
  const delta = modifiers.selections.reduce((sum, s) => sum + s.priceDelta, 0);
  return (product.basePrice + delta) * quantity;
}

export interface AppliedVoucher {
  code: string;
  voucherId: string;
  discountSen: number;
  discountLabel: string;
  message: string;
}

export interface RecentOrder {
  orderId: string;
  orderNumber: string;
  storeId: string;
  totalSen: number;
  itemCount: number;
  createdAt: string;
}

export interface LoyaltyMember {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
  totalPointsEarned: number;
  totalVisits: number;
}

interface CartState {
  items: CartItem[];
  selectedStore: Store | null;
  appliedVoucher: AppliedVoucher | null;
  recentOrders: RecentOrder[];
  loyaltyMember: LoyaltyMember | null;
  _hasHydrated: boolean;
  setSelectedStore: (store: Store) => void;
  addItem: (product: Product, modifiers: CartItemModifiers) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
  getItemCount: () => number;
  setAppliedVoucher: (voucher: AppliedVoucher | null) => void;
  addRecentOrder: (order: RecentOrder) => void;
  setLoyaltyMember: (member: LoyaltyMember | null) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedStore: null,
      appliedVoucher: null,
      recentOrders: [],
      loyaltyMember: null,
      _hasHydrated: false,

      setSelectedStore: (store) => set({ selectedStore: store }),

      addItem: (product, modifiers) => {
        // If an identical item (same product + same modifier selections) exists, increment it
        const existing = get().items.find(
          (item) =>
            item.product.id === product.id &&
            JSON.stringify(item.modifiers.selections) === JSON.stringify(modifiers.selections) &&
            (item.modifiers.specialInstructions ?? "") === (modifiers.specialInstructions ?? "")
        );
        if (existing) {
          get().updateQuantity(existing.id, existing.quantity + 1);
          return;
        }
        const totalPrice = calculateItemPrice(product, modifiers, 1);
        const newItem: CartItem = {
          id: generateCartItemId(),
          product,
          quantity: 1,
          modifiers,
          totalPrice,
        };
        set((state) => ({ items: [...state.items, newItem] }));
      },

      removeItem: (itemId) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== itemId),
        }));
      },

      updateQuantity: (itemId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return;
        }
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  quantity,
                  totalPrice: calculateItemPrice(
                    item.product,
                    item.modifiers,
                    quantity
                  ),
                }
              : item
          ),
        }));
      },

      clearCart: () => set({ items: [], appliedVoucher: null }),

      getTotal: () => {
        return get().items.reduce((sum, item) => sum + item.totalPrice, 0);
      },

      getItemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },

      setAppliedVoucher: (voucher) => set({ appliedVoucher: voucher }),

      addRecentOrder: (order) => {
        set((state) => ({
          recentOrders: [order, ...state.recentOrders].slice(0, 20),
        }));
      },

      setLoyaltyMember: (member) => set({ loyaltyMember: member }),
    }),
    {
      name: "celsius-cart",
      onRehydrateStorage: () => (state) => {
        if (state) state._hasHydrated = true;
      },
    }
  )
);
