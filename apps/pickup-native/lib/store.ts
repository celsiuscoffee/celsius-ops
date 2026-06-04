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
  /** Product category slug — needed so rewards with
   *  applicable_categories can filter the cart down to eligible
   *  items (free_item picks the cheapest of the eligible set, not
   *  the cheapest of the whole cart). Optional because legacy
   *  persisted carts won't have it set; calcRewardDiscount falls
   *  back to "all items" when none of the cart has a category. */
  category?: string;
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
  discount_type:
    | "flat" | "percent" | "free_item" | "free_upgrade" | "fixed_amount"
    | "percentage" | "bogo" | "combo" | "override_price" | "none" | null;
  discount_value: number | null;
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  /** combo bundle price / override single-item price, in SEN. */
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  /** bogo/free_item: the specific product(s) given free. */
  free_product_ids?: string[] | null;
  free_product_name?: string | null;
  /** Categories the reward applies to. When set + non-empty, the
   *  free_item / bogo discount picks the cheapest item whose
   *  category is in this list; null means "any item". */
  applicable_categories?: string[] | null;
  /** Whitelist of product IDs the reward applies to. Same fallback
   *  semantics as applicable_categories. */
  applicable_products?: string[] | null;
  min_order_value?: number | null;
  /** When set, this AppliedReward originated from a wallet voucher
   *  (issued_rewards row) rather than a points-shop redemption.
   *  Checkout uses this to mark the voucher redeemed instead of
   *  deducting Points. Always omitted for points-shop rewards. */
  voucher_id?: string;
};

/** Minimal voucher payload kept in store for the "locked in" banner
 *  to render without an extra fetch. Full voucher data still lives in
 *  the API / React Query cache. */
export type ReservedVoucher = {
  id: string;
  title: string;
  category: "free_item" | "upgrade" | "discount" | "multiplier" | "special";
  icon: string;
  expires_at: string | null;
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
  /** Order fulfilment context. Set to "dine_in" + a tableNumber when the
   *  customer enters via a table-QR deep link (app/table/[outletId]/[tableId]);
   *  null/"pickup" otherwise. Deliberately NOT persisted (see partialize) —
   *  a per-visit context that must reset on app kill so someone who scanned
   *  Table 5 yesterday doesn't silently place a dine-in Table-5 order from
   *  home today. */
  orderType: "pickup" | "dine_in" | null;
  tableNumber: string | null;
  cart: CartItem[];
  phone: string | null;
  loyaltyId: string | null;
  member: MemberProfile | null;
  appliedReward: AppliedReward | null;
  /** Customer session JWT issued by the order app on OTP verify.
   *  Sent as `Authorization: Bearer ${sessionToken}` on every
   *  member-scoped fetch so the server doesn't have to trust
   *  `phone` / `member_id` body params (which would let any caller
   *  read or delete any account by guessing the phone). Null until
   *  the customer signs in; cleared by signOutReset(). */
  sessionToken: string | null;

  /** Voucher the customer tapped "Use" on from the wallet. When set,
   *  the menu and cart screens show a "Voucher locked in" banner and
   *  the voucher pre-selects at checkout. Cleared on order success,
   *  sign-out, or user dismiss. */
  reservedVoucher: ReservedVoucher | null;

  /** One-time tooltips the customer has already dismissed. Avoids
   *  showing the same "what's new" sheet twice on the same install. */
  seenOnboardings: string[];

  setOutlet: (id: string, name: string) => void;
  /** Enter dine-in mode from a table-QR deep link: pin the outlet, flag
   *  dine_in + table, and start a clean basket (mirrors the PWA's
   *  _TableEntry — a fresh table session shouldn't inherit a stale cart). */
  setDineIn: (outletId: string, outletName: string, tableNumber: string) => void;
  /** Drop back to pickup (clears the table context; leaves the cart). */
  clearDineIn: () => void;
  addToCart: (item: Omit<CartItem, "cartId">) => void;
  /** Replace an existing cart line in-place — preserves its position
   *  in the array (so the customer's edit doesn't reshuffle the cart)
   *  and atomically swaps the modifiers / qty / notes / totalPrice. The
   *  cart-row "tap to edit" flow uses this so the edited line lands
   *  exactly where the original was, not at the bottom. */
  replaceCartItem: (cartId: string, item: Omit<CartItem, "cartId">) => void;
  updateQuantity: (cartId: string, qty: number) => void;
  removeFromCart: (cartId: string) => void;
  clearCart: () => void;
  setPhone: (phone: string) => void;
  setLoyaltyId: (id: string | null) => void;
  setMember: (m: MemberProfile | null) => void;
  setAppliedReward: (reward: AppliedReward | null) => void;
  setSessionToken: (token: string | null) => void;
  setReservedVoucher: (voucher: ReservedVoucher | null) => void;
  markOnboardingSeen: (key: string) => void;
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
      orderType: null,
      tableNumber: null,
      cart: [],
      phone: null,
      loyaltyId: null,
      member: null,
      appliedReward: null,
      sessionToken: null,
      reservedVoucher: null,
      seenOnboardings: [],

      setOutlet: (id, name) => set({ outletId: id, outletName: name }),
      setDineIn: (outletId, outletName, tableNumber) =>
        set({
          outletId,
          outletName,
          orderType: "dine_in",
          tableNumber,
          cart: [],
          appliedReward: null,
        }),
      clearDineIn: () => set({ orderType: "pickup", tableNumber: null }),
      addToCart: (item) =>
        set((s) => ({
          cart: [
            ...s.cart,
            { ...item, cartId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
          ],
        })),
      replaceCartItem: (cartId, item) =>
        set((s) => ({
          cart: s.cart.map((i) => (i.cartId === cartId ? { ...item, cartId } : i)),
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
      setSessionToken: (token) => set({ sessionToken: token }),
      setReservedVoucher: (voucher) => set({ reservedVoucher: voucher }),
      markOnboardingSeen: (key) =>
        set((s) => ({
          seenOnboardings: s.seenOnboardings.includes(key)
            ? s.seenOnboardings
            : [...s.seenOnboardings, key],
        })),
      signOutReset: () =>
        set({
          phone: null,
          loyaltyId: null,
          member: null,
          cart: [],
          appliedReward: null,
          sessionToken: null,
          reservedVoucher: null,
          orderType: null,
          tableNumber: null,
        }),
    }),
    {
      name: "celsius-pickup",
      // Versioned baseline. When the persisted shape changes, bump
      // this number and add a `migrate` branch so existing installs
      // don't crash on hydrate. Without a baseline, every future
      // change risks an NPE on every device on first launch after
      // the new bundle lands.
      version: 2,
      migrate: (persisted, fromVersion) => {
        // v1 → v2: clear any persisted appliedReward. Reason — the
        //   `rewards` catalog rows (Free Drink, RM5, RM10) shipped
        //   with discount_type=null for ~3 weeks. Customers who
        //   tapped Free Drink during that window have a persisted
        //   appliedReward.discount_type=null in localStorage that
        //   never refreshes — silently returns 0 discount at
        //   checkout, even after we backfilled the catalog (commit
        //   e4c0d792). Wipe it on first launch so the next tap
        //   picks up the live `discount_type='free_item'`.
        const p = persisted as { appliedReward?: unknown };
        if (fromVersion < 2 && p && typeof p === "object") {
          p.appliedReward = null;
        }
        return persisted as AppState;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        outletId: s.outletId,
        outletName: s.outletName,
        // orderType / tableNumber are intentionally NOT persisted — dine-in
        // is a per-visit context re-established by the table-QR deep link on
        // each launch; persisting it would strand a customer in "dine-in
        // Table N" mode after they've left the cafe.
        cart: s.cart,
        phone: s.phone,
        loyaltyId: s.loyaltyId,
        member: s.member,
        appliedReward: s.appliedReward,
        sessionToken: s.sessionToken,
      }),
    }
  )
);

export const cartTotal = (cart: CartItem[]) =>
  cart.reduce((sum, i) => sum + i.totalPrice, 0);

export const cartCount = (cart: CartItem[]) =>
  cart.reduce((sum, i) => sum + i.quantity, 0);
