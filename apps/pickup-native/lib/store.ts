import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ModifierSelection = {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  priceDelta: number;
};

export type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  image?: string;
  basePrice: number;
  quantity: number;
  modifiers: ModifierSelection[];
  specialInstructions?: string;
  totalPrice: number;
};

export type AppliedReward = {
  id: string;
  name: string;
  points_required: number;
  discount_type: "flat" | "percent" | "free_item" | "bogo" | "fixed_amount" | "percentage" | "none" | null;
  discount_value: number | null;
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  free_product_name?: string | null;
};

export type MemberProfile = {
  id: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
  pointsBalance: number;
  totalVisits: number;
  totalPointsEarned: number;
};

type AppState = {
  outletId: string | null;
  outletName: string | null;
  cart: CartItem[];
  phone: string | null;
  loyaltyId: string | null;
  member: MemberProfile | null;
  appliedReward: AppliedReward | null;

  setOutlet: (id: string, name: string) => void;
  addToCart: (item: Omit<CartItem, "cartId">) => void;
  updateQuantity: (cartId: string, qty: number) => void;
  removeFromCart: (cartId: string) => void;
  clearCart: () => void;
  setPhone: (phone: string) => void;
  setLoyaltyId: (id: string | null) => void;
  setMember: (m: MemberProfile | null) => void;
  setAppliedReward: (reward: AppliedReward | null) => void;
  /** Wipe every per-customer field in one shot. Call on sign-out so
   *  the next customer (or family member) can't see the previous
   *  account's cart, applied reward, or member profile. */
  signOutReset: () => void;
};

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      outletId: null,
      outletName: null,
      cart: [],
      phone: null,
      loyaltyId: null,
      member: null,
      appliedReward: null,

      setOutlet: (id, name) => set({ outletId: id, outletName: name }),
      addToCart: (item) =>
        set((s) => ({
          cart: [
            ...s.cart,
            { ...item, cartId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
          ],
        })),
      updateQuantity: (cartId, qty) =>
        set((s) => ({
          cart: s.cart
            .map((i) =>
              i.cartId === cartId
                ? { ...i, quantity: qty, totalPrice: (i.totalPrice / i.quantity) * qty }
                : i
            )
            .filter((i) => i.quantity > 0),
        })),
      removeFromCart: (cartId) => set((s) => ({ cart: s.cart.filter((i) => i.cartId !== cartId) })),
      clearCart: () => set({ cart: [], appliedReward: null }),
      setPhone: (phone) => set({ phone }),
      setLoyaltyId: (id) => set({ loyaltyId: id }),
      setMember: (m) => set({ member: m }),
      setAppliedReward: (reward) => set({ appliedReward: reward }),
      signOutReset: () =>
        set({
          phone: null,
          loyaltyId: null,
          member: null,
          cart: [],
          appliedReward: null,
        }),
    }),
    {
      name: "celsius-pickup",
      // Versioned baseline. When the persisted shape changes, bump
      // this number and add a `migrate` branch so existing installs
      // don't crash on hydrate. Without a baseline, every future
      // change risks an NPE on every device on first launch after
      // the new bundle lands.
      version: 1,
      migrate: (persisted, fromVersion) => {
        // No previous versions yet — accept whatever we get and let
        // partialize re-pin the shape. Future migrations branch on
        // `fromVersion` to transform old payloads.
        if (fromVersion < 1) return persisted as AppState;
        return persisted as AppState;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        outletId: s.outletId,
        outletName: s.outletName,
        cart: s.cart,
        phone: s.phone,
        loyaltyId: s.loyaltyId,
        member: s.member,
        appliedReward: s.appliedReward,
      }),
    }
  )
);

export const cartTotal = (cart: CartItem[]) =>
  cart.reduce((sum, i) => sum + i.totalPrice, 0);

export const cartCount = (cart: CartItem[]) =>
  cart.reduce((sum, i) => sum + i.quantity, 0);
