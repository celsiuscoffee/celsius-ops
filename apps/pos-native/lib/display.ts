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
} | null;

type DisplayState = {
  status: DisplayStatus;
  member: DisplayMember;
  orderNumber: string | null;
  setStatus: (s: DisplayStatus) => void;
  setMember: (m: DisplayMember) => void;
  setOrderNumber: (n: string | null) => void;
  reset: () => void;
};

export const useDisplay = create<DisplayState>((set) => ({
  status: "idle",
  member: null,
  orderNumber: null,
  setStatus: (status) => set({ status }),
  setMember: (member) => set({ member }),
  setOrderNumber: (orderNumber) => set({ orderNumber }),
  reset: () => set({ status: "idle", member: null, orderNumber: null }),
}));
