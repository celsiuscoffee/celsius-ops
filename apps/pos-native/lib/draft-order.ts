// Crash/hang recovery for the in-progress order. The live cart (lib/cart.ts) is
// in-memory so a relaunch starts blank; if the till hangs and the cashier
// restarts it, the whole basket was lost and had to be re-keyed. This module
// keeps a DURABLE copy of the in-progress order (debounced on every change) and
// the register offers to RESUME it on relaunch — but only if it's recent, so a
// genuinely abandoned basket is never silently resurrected.
//
// Lifecycle:
//   • saveDraft   — debounced write on any cart/context change (skipped for an
//                   empty cart).
//   • loadDraft   — on register mount; returns the draft only if < TTL old,
//                   else purges it.
//   • clearDraft  — the instant a sale is created (so a hang mid-checkout can't
//                   resurrect a paid order), and whenever the cart goes empty.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CartLine } from "./cart";
import type { Member, RedeemDiscount } from "./loyalty";

const KEY = "pos.draft.order.v1";
// Older than this = abandoned, not a crash to recover. A hang+restart is quick.
const TTL_MS = 15 * 60 * 1000;

// Structural mirror of register's AppliedReward (kept here so this module needn't
// import the screen). Round-trips through JSON and is fed straight to setReward().
export type DraftReward = {
  redemptionId: string | null;
  rewardId: string | null;
  name: string;
  descriptor: RedeemDiscount;
  pointsCost: number;
} | null;

export type DraftOrder = {
  lines: CartLine[];
  member: Member | null;
  reward: DraftReward;
  manualDiscount: number;
  orderType: "dine_in" | "takeaway";
  tableNumber: string;
  memberAsked: boolean;
  savedAt: number;
};

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist the in-progress order (debounced ~400ms). An empty cart clears the
 *  draft rather than saving — there's nothing to recover. */
export function saveDraft(d: Omit<DraftOrder, "savedAt">): void {
  if (writeTimer) clearTimeout(writeTimer);
  if (!d.lines.length) {
    void clearDraft();
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const payload: DraftOrder = { ...d, savedAt: Date.now() };
    AsyncStorage.setItem(KEY, JSON.stringify(payload)).catch(() => {});
  }, 400);
}

/** The recoverable draft, or null if none / too old. Stale drafts are purged. */
export async function loadDraft(): Promise<DraftOrder | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftOrder;
    if (!d?.lines?.length) return null;
    if (Date.now() - (d.savedAt ?? 0) > TTL_MS) {
      await clearDraft();
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** Remove the draft (and cancel any pending debounced write so it can't
 *  re-create it right after). */
export async function clearDraft(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
