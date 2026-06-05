import { create } from "zustand";

/**
 * Customer-display UI state shared in-process with the register.
 *
 * Because the native app drives BOTH SUNMI screens from one JS
 * runtime (register on the main display, customer-display on the
 * secondary display via a native Presentation), the two screens just
 * share zustand stores — no Supabase Realtime bridge, no cross-process
 * latency, no teardown-recursion bug. The register mutates this store
 * + the cart store; the customer-display reads them and re-renders
 * instantly.
 *
 * `status` drives what the second screen shows:
 *   idle      → welcome / posters (no active cart)
 *   ordering  → live cart mirror
 *   payment   → full-screen pay QR
 *   complete  → thank-you / mystery reveal
 */
export type DisplayStatus = "idle" | "ordering" | "payment" | "complete";

export type DisplayMember = {
  id: string;
  name: string | null;
  phone: string;
  pointsBalance: number;
  tierName?: string | null;
  tierColor?: string | null;
  /** First-ever visit (total_visits === 0) → greet as a new member instead
   *  of "welcome back". */
  isNew?: boolean;
} | null;

export type DisplayReward = { name: string; discountSen: number } | null;
/** Auto tier% + promotions, combined, mirrored to the customer screen. */
export type DisplayExtraDiscount = { label: string; sen: number } | null;
export type DisplayOrderType = "dine_in" | "takeaway";
/** Which tender the cashier chose — drives the pay screen: QR scan-to-pay vs a
 *  distinct "pay by card on the terminal" prompt. null until a method is picked. */
export type DisplayPayMethod = "qr" | "card" | null;
/** Reverse channel: a reward the customer tapped to redeem on the 2nd screen.
 *  The register watches this, applies it to the cart, then clears it. */
export type DisplayRedeemRequest = { rewardId: string | null; issuedRewardId: string | null; name: string } | null;

type DisplayState = {
  status: DisplayStatus;
  member: DisplayMember;
  orderNumber: string | null;
  /** The completed order's UUID — so a guest can claim its Beans by entering
   *  their phone on the thank-you screen (awards via /api/pos/loyalty/complete). */
  orderId: string | null;
  // Order context mirrored to the customer screen.
  orderType: DisplayOrderType;
  tableNumber: string | null;
  reward: DisplayReward;
  extraDiscount: DisplayExtraDiscount;
  /** Cashier-applied manual discount, mirrored as its own line. */
  manualDiscount: DisplayExtraDiscount;
  /** Amount payable on the pay screen (sen). */
  payTotal: number;
  /** Tender the cashier chose (qr/card) — null until picked. */
  payMethod: DisplayPayMethod;
  /** Beans the member earned on the just-completed order (thank-you summary). */
  beansEarned: number;
  redeemRequest: DisplayRedeemRequest;
  /** Short, customer-facing reason a 2nd-screen redeem tap couldn't be applied
   *  (e.g. "Spend RM1.30 more to use this reward"). Shown as a toast on the
   *  display, then cleared; null when there's nothing to show. */
  redeemError: string | null;
  setStatus: (s: DisplayStatus) => void;
  setMember: (m: DisplayMember) => void;
  setOrderNumber: (n: string | null) => void;
  setOrderId: (id: string | null) => void;
  setOrderType: (t: DisplayOrderType) => void;
  setTableNumber: (n: string | null) => void;
  setReward: (r: DisplayReward) => void;
  setExtraDiscount: (d: DisplayExtraDiscount) => void;
  setManualDiscount: (d: DisplayExtraDiscount) => void;
  setPayTotal: (n: number) => void;
  setPayMethod: (m: DisplayPayMethod) => void;
  setBeansEarned: (n: number) => void;
  setRedeemRequest: (r: DisplayRedeemRequest) => void;
  setRedeemError: (m: string | null) => void;
  reset: () => void;
};

export const useDisplay = create<DisplayState>((set) => ({
  status: "idle",
  member: null,
  orderNumber: null,
  orderId: null,
  orderType: "takeaway",
  tableNumber: null,
  reward: null,
  extraDiscount: null,
  manualDiscount: null,
  payTotal: 0,
  payMethod: null,
  beansEarned: 0,
  redeemRequest: null,
  redeemError: null,
  setStatus: (status) => set({ status }),
  setMember: (member) => set({ member }),
  setOrderNumber: (orderNumber) => set({ orderNumber }),
  setOrderId: (orderId) => set({ orderId }),
  setOrderType: (orderType) => set({ orderType }),
  setTableNumber: (tableNumber) => set({ tableNumber }),
  setReward: (reward) => set({ reward }),
  setExtraDiscount: (extraDiscount) => set({ extraDiscount }),
  setManualDiscount: (manualDiscount) => set({ manualDiscount }),
  setPayTotal: (payTotal) => set({ payTotal }),
  setPayMethod: (payMethod) => set({ payMethod }),
  setBeansEarned: (beansEarned) => set({ beansEarned }),
  setRedeemRequest: (redeemRequest) => set({ redeemRequest }),
  setRedeemError: (redeemError) => set({ redeemError }),
  // Keep member identified across orders (a returning regular stays
  // logged in for the next basket); only clear cart-scoped context.
  reset: () => set({ status: "idle", orderNumber: null, orderId: null, reward: null, extraDiscount: null, manualDiscount: null, tableNumber: null, payTotal: 0, payMethod: null, beansEarned: 0, redeemRequest: null, redeemError: null }),
}));
