import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Kitchen-docket routing prefs for this terminal.
 *
 * Controls the consolidated "ORDER" master docket the D3 prints alongside the
 * per-station LAN dockets (see network-printer.ts routeKitchenDockets):
 *   - ON  → the D3 prints the WHOLE order as an expo/counter copy, on top of
 *     each station printer getting its own items.
 *   - OFF → the D3 skips that master copy. The customer receipt already lists
 *     every item, so the counter works off the receipt and each station printer
 *     just prints its own dockets. (Only affects outlets that have LAN station
 *     printers; with none, nothing changes.)
 *
 * Two layers:
 *   - `outletDefault` comes from pos_branch_settings.print_master_docket, set in
 *     Backoffice → POS Settings → Kitchen Dockets, and fed in via
 *     setOutletDefault() once the settings row loads. This is the central,
 *     BO-managed default for every till at the outlet.
 *   - `override` is a per-TILL choice stored LOCALLY (AsyncStorage) — the till's
 *     anon key can't write pos_branch_settings (security lockdown), so a single
 *     terminal that wants to differ from its outlet sets it from the on-device
 *     Settings screen. null → follow the outlet default.
 *
 * `printMaster` is the EFFECTIVE value the routing reads = override ?? outletDefault.
 */
const KEY = "pos.printprefs.v1";
const DEF_MASTER = true;

type PrintPrefs = {
  /** Effective value used by the print routing (override ?? outletDefault). */
  printMaster: boolean;
  /** Per-till local override; null → follow the outlet default. */
  override: boolean | null;
  /** BO-managed outlet default (pos_branch_settings.print_master_docket). */
  outletDefault: boolean;
  loaded: boolean;
  /** Read this till's local override from storage. */
  load: () => Promise<void>;
  /** Apply the outlet default after pos_branch_settings loads. */
  setOutletDefault: (v: boolean) => void;
  /** Operator on this till: true/false → override; null → follow the outlet. */
  setPrintMaster: (v: boolean | null) => void;
};

export const usePrintPrefs = create<PrintPrefs>((set) => ({
  printMaster: DEF_MASTER,
  override: null,
  outletDefault: DEF_MASTER,
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as { override?: boolean | null; printMaster?: boolean };
        // New shape stores `override`; migrate a legacy `printMaster` value into one.
        const ov = v.override !== undefined ? v.override : (typeof v.printMaster === "boolean" ? v.printMaster : null);
        set((s) => ({ override: ov, printMaster: ov ?? s.outletDefault, loaded: true }));
        return;
      }
    } catch {
      /* fall through to default */
    }
    set({ loaded: true });
  },
  setOutletDefault: (v) => set((s) => ({ outletDefault: v, printMaster: s.override ?? v })),
  setPrintMaster: (v) => {
    set((s) => ({ override: v, printMaster: v ?? s.outletDefault }));
    AsyncStorage.setItem(KEY, JSON.stringify({ override: v })).catch(() => {});
  },
}));
