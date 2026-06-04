import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-DEVICE kitchen-docket routing prefs for this terminal.
 *
 * `printMaster` controls the consolidated "ORDER" master docket the D3 prints
 * alongside the per-station LAN dockets (see network-printer.ts routeKitchenDockets):
 *   - ON  (default) → the D3 prints the WHOLE order as an expo/counter copy,
 *     in addition to each station printer getting its own items.
 *   - OFF → the D3 skips that master copy. The customer receipt already lists
 *     every item, so the counter works off the receipt and each station printer
 *     just prints its own dockets — no duplicate ticket. (Only affects outlets
 *     that have LAN station printers; with none, nothing changes.)
 *
 * Stored LOCALLY (AsyncStorage), like grid-prefs — it's a per-terminal operational
 * preference and the till's anon key can't write pos_branch_settings (security
 * lockdown). Editable from the on-device Settings screen.
 */
const KEY = "pos.printprefs.v1";
const DEF_MASTER = true;

type PrintPrefs = {
  printMaster: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setPrintMaster: (v: boolean) => void;
};

export const usePrintPrefs = create<PrintPrefs>((set) => ({
  printMaster: DEF_MASTER,
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as { printMaster?: boolean };
        set({ printMaster: v.printMaster ?? DEF_MASTER, loaded: true });
        return;
      }
    } catch {
      /* fall through to default */
    }
    set({ loaded: true });
  },
  setPrintMaster: (v) => {
    set({ printMaster: v });
    AsyncStorage.setItem(KEY, JSON.stringify({ printMaster: v })).catch(() => {});
  },
}));
