import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * POS session store. Holds the cashier's chosen outlet + the logged-in
 * staff identity. Outlet selection is persisted (a terminal lives at
 * one outlet — no need to re-pick every shift); the staff session is
 * also persisted so a relaunch doesn't force a re-login mid-shift, but
 * any explicit Sign Out clears it.
 */

export type StaffSession = {
  staffId: string;
  staffName: string;
  role: string;
  /** POS session JWT from /api/pos/auth/pin, replayed as `Authorization:
   *  Bearer <token>` on POS API calls. The till can't use the httpOnly
   *  celsius-pos-session cookie the same endpoint sets, so it carries the
   *  token here. Null for sessions minted before this field existed. */
  token: string | null;
};

/** Staff sessions auto-expire 2 hours after sign-in — the till re-prompts for
 *  a PIN so it's never left logged in unattended across shifts. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Has the staff session passed its 2-hour lifetime? */
export function sessionExpired(loggedInAt: number | null): boolean {
  return loggedInAt != null && Date.now() - loggedInAt >= SESSION_TTL_MS;
}

/** Has the current staff session ended? A rostered ("Open Store") session
 *  ends at its scheduled shift end (`shiftEndsAt`, returned by the auth
 *  endpoint, already incl. a wind-down grace); an off-schedule / manager
 *  override session falls back to the fixed 2-hour TTL. */
export function shiftSessionExpired(loggedInAt: number | null, shiftEndsAt: number | null): boolean {
  // A rostered session expires at its shift end — but ONLY if it actually began
  // during that shift. Logging in AFTER the shift end (e.g. to hand over orders
  // left over from a shift that already closed) must NOT instantly re-expire —
  // that was the sign-in → immediate sign-out loop. In that case fall back to
  // the normal idle TTL so the cashier can log in and work.
  if (shiftEndsAt != null && loggedInAt != null && loggedInAt < shiftEndsAt) {
    return Date.now() >= shiftEndsAt;
  }
  return sessionExpired(loggedInAt);
}

type PosState = {
  outletId: string | null;
  staff: StaffSession | null;
  /** Epoch ms the current staff signed in — drives the 2h fallback auto-logout. */
  loggedInAt: number | null;
  /** Epoch ms the rostered shift ends — drives the "Open Store" auto-logout.
   *  null when the login wasn't schedule-bound (manager / override / no roster),
   *  in which case the 2h TTL applies instead. */
  shiftEndsAt: number | null;
  /** "Sleep/lock" mode: the auto-logout timer locks the till behind a PIN
   *  overlay INSTEAD of signing out + leaving the register, so the screen's
   *  online-order auto-printers + chime keep running while the till is idle.
   *  Not persisted — a relaunch goes through the normal login. */
  locked: boolean;
  setOutlet: (id: string) => void;
  setStaff: (s: StaffSession, shiftEndsAt?: number | null) => void;
  signOut: () => void;
  lock: () => void;
  unlock: () => void;
};

export const usePos = create<PosState>()(
  persist(
    (set) => ({
      outletId: null,
      staff: null,
      loggedInAt: null,
      shiftEndsAt: null,
      locked: false,
      setOutlet: (id) => set({ outletId: id }),
      // Stamp the sign-in time + (optional) rostered shift end so the session
      // can auto-expire at shift end, or after SESSION_TTL_MS as a fallback.
      // A fresh sign-in always clears the lock.
      setStaff: (s, shiftEndsAt = null) => set({ staff: s, loggedInAt: Date.now(), shiftEndsAt, locked: false }),
      signOut: () => set({ staff: null, loggedInAt: null, shiftEndsAt: null, locked: false }),
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false }),
    }),
    {
      name: "celsius-pos-session",
      storage: createJSONStorage(() => AsyncStorage),
      // Persist the session (incl. when it started) so a relaunch keeps the
      // cashier logged in mid-shift — but a session older than 2h is treated
      // as expired on the next launch / tick. Cart is NOT persisted (it lives
      // in the register screen; never survive a relaunch).
      partialize: (s) => ({ outletId: s.outletId, staff: s.staff, loggedInAt: s.loggedInAt, shiftEndsAt: s.shiftEndsAt }),
    },
  ),
);
