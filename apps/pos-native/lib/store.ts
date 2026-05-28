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

type PosState = {
  outletId: string | null;
  staff: StaffSession | null;
  setOutlet: (id: string) => void;
  setStaff: (s: StaffSession) => void;
  signOut: () => void;
};

export const usePos = create<PosState>()(
  persist(
    (set) => ({
      outletId: null,
      staff: null,
      setOutlet: (id) => set({ outletId: id }),
      setStaff: (s) => set({ staff: s }),
      signOut: () => set({ staff: null }),
    }),
    {
      name: "celsius-pos-session",
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist the cart here — it lives in the register screen
      // and should never survive a relaunch (avoids charging a stale
      // basket the next morning).
      partialize: (s) => ({ outletId: s.outletId, staff: s.staff }),
    },
  ),
);
