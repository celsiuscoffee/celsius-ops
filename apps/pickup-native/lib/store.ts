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
  /** True when this line was added from a "Pair with a Bite" upsell
   *  suggestion (vs. a direct product add). Carried through to the order so
   *  the sales dashboard can count pairs that actually checked out. */
  isPair?: boolean;
};

export type AppliedReward = {
  id: string;
  name: string;
  points_required: number;
  discount_type:
    | "flat" | "percent" | "free_item" | "fixed_amount"
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
  /** Channels the reward is valid for (pickup / dine_in / qr_table …). Empty
   *  or null = no restriction (today every reward is unrestricted). Carried
   *  on the applied reward so checkout can re-validate it against the current
   *  order type and surface a "not valid for dine-in/takeaway" warning. */
  fulfillment_type?: string[] | null;
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
  /** The ACTIVE outlet — what the order is tagged with AND what the UI shows.
   *  In dine-in mode a table scan repoints this to the scanned cafe; on return
   *  to pickup it's restored from pickupOutlet* below. */
  outletId: string | null;
  outletName: string | null;
  /** The customer's deliberate PICKUP outlet (set from the outlet picker).
   *  Persisted separately so a transient dine-in table scan can't silently
   *  leave Pickup pointed at the scanned outlet — clearDineIn restores from it. */
  pickupOutletId: string | null;
  pickupOutletName: string | null;
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
  /** Correct just the displayed outlet name to match outletId — used by the
   *  home once the outlets list loads, so the UI can never show one outlet
   *  while the order routes to another. */
  setOutletName: (name: string) => void;
  /** Enter dine-in mode from a table-QR scan / deep link: pin the outlet,
   *  flag dine_in + table. Keeps the cart when it's the same outlet the
   *  customer's already on; clears it (and the reward) only when the outlet
   *  changes, since the menu/prices differ. */
  setDineIn: (outletId: string, outletName: string, tableNumber: string) => void;
  /** Drop back to pickup (clears the table context; leaves the cart). */
  clearDineIn: () => void;
  /** Toggle the fulfilment context from the cart/checkout (the McD-style
   *  Takeaway | Dine-In switch). Preserves the cart + applied reward — only
   *  the channel changes; the reward's eligibility is re-checked in the UI.
   *  Switching to dine_in needs a tableNumber (pass the scanned/typed one;
   *  falls back to the current table if already set). */
  setOrderType: (next: "pickup" | "dine_in", tableNumber?: string) => void;
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
      pickupOutletId: null,
      pickupOutletName: null,
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

      // A deliberate pickup-outlet choice → set the active AND the persisted
      // pickup outlet, so dine-in scans never overwrite the customer's pickup.
      setOutlet: (id, name) => set({ outletId: id, outletName: name, pickupOutletId: id, pickupOutletName: name }),
      setOutletName: (name) => set({ outletName: name }),
      setDineIn: (outletId, outletName, tableNumber) =>
        set((s) => {
          // Keep the basket when scanning a table at the SAME outlet the
          // customer's already on (decision: an order-type change preserves
          // the cart). A DIFFERENT outlet means a different menu / prices, so
          // clear the cart + the now-moot reward — the standard outlet-change
          // rule, and what keeps native/PWA/toggle paths consistent.
          const outletChanged = s.outletId !== outletId;
          return {
            outletId,
            // Scan / deep-link passes "" and backfills the name async; don't
            // blank an already-correct name in the meantime.
            outletName: outletName || s.outletName,
            orderType: "dine_in",
            tableNumber,
            cart: outletChanged ? [] : s.cart,
            appliedReward: outletChanged ? null : s.appliedReward,
          };
        }),
      clearDineIn: () =>
        set((s) => ({
          orderType: "pickup",
          tableNumber: null,
          // A table scan only BORROWS the active outlet for the dine-in visit —
          // returning to pickup restores the customer's own pickup outlet so it
          // never gets silently left on the scanned cafe. Falls back to the
          // current outlet for customers who hadn't picked one before this build.
          outletId: s.pickupOutletId ?? s.outletId,
          outletName: s.pickupOutletName ?? s.outletName,
        })),
      setOrderType: (next, tableNumber) =>
        set((s) => ({
          orderType: next,
          // dine_in needs a table — use the passed one, else keep the current
          // (customer toggled to Takeaway and back). Takeaway drops it.
          tableNumber: next === "dine_in" ? (tableNumber ?? s.tableNumber) : null,
          // cart + appliedReward preserved; the validity panel re-checks the
          // reward against the new channel and blocks checkout if ineligible.
        })),
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
        pickupOutletId: s.pickupOutletId,
        pickupOutletName: s.pickupOutletName,
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
