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
};

/** Staff sessions auto-expire 2 hours after sign-in — the till re-prompts for
 *  a PIN so it's never left logged in unattended across shifts. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Has the staff session passed its 2-hour lifetime? */
export function sessionExpired(loggedInAt: number | null): boolean {
  return loggedInAt != null && Date.now() - loggedInAt >= SESSION_TTL_MS;
}

type PosState = {
  outletId: string | null;
  staff: StaffSession | null;
  /** Epoch ms the current staff signed in — drives the 2h auto-logout. */
  loggedInAt: number | null;
  setOutlet: (id: string) => void;
  setStaff: (s: StaffSession) => void;
  signOut: () => void;
};

export const usePos = create<PosState>()(
  persist(
    (set) => ({
      outletId: null,
      staff: null,
      loggedInAt: null,
      setOutlet: (id) => set({ outletId: id }),
      // Stamp the sign-in time so the session can auto-expire after SESSION_TTL_MS.
      setStaff: (s) => set({ staff: s, loggedInAt: Date.now() }),
      signOut: () => set({ staff: null, loggedInAt: null }),
    }),
    {
      name: "celsius-pos-session",
      storage: createJSONStorage(() => AsyncStorage),
      // Persist the session (incl. when it started) so a relaunch keeps the
      // cashier logged in mid-shift — but a session older than 2h is treated
      // as expired on the next launch / tick. Cart is NOT persisted (it lives
      // in the register screen; never survive a relaunch).
      partialize: (s) => ({ outletId: s.outletId, staff: s.staff, loggedInAt: s.loggedInAt }),
    },
  ),
);
