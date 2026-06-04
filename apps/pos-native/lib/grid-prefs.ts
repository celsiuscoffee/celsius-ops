import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-DEVICE display prefs for the register's "All" category tab only.
 *
 * The All tab shows the full catalogue (~82 items), so the default square-image
 * cards make it a long scroll. These let the cashier compact the All tab —
 * more columns + a shorter (or hidden) product image — to fit far more per
 * screen while keeping tap targets sane. Other category tabs are unaffected.
 *
 * Stored LOCALLY (AsyncStorage), not in pos_branch_settings: it's a per-terminal
 * display preference, and the till's anon key can only write queue_counter on
 * pos_branch_settings (security lockdown). Editable from the on-device Settings
 * screen. Defaults are an already-optimised compact layout.
 */
const KEY = "pos.allgrid.v1";
const DEF_COLS = 6;
const DEF_IMG = 110; // px image height on All-tab cards; 0 = no image (text-only)

export const ALL_COLS_MIN = 4, ALL_COLS_MAX = 8;
export const ALL_IMG_MIN = 0, ALL_IMG_MAX = 240, ALL_IMG_STEP = 10;

const clampCols = (n: number) => Math.max(ALL_COLS_MIN, Math.min(ALL_COLS_MAX, Math.round(n)));
const clampImg = (n: number) => Math.max(ALL_IMG_MIN, Math.min(ALL_IMG_MAX, Math.round(n)));

type GridPrefs = {
  allColumns: number;
  allImageHeight: number;
  loaded: boolean;
  load: () => Promise<void>;
  setColumns: (n: number) => void;
  setImageHeight: (n: number) => void;
};

function persist(allColumns: number, allImageHeight: number) {
  AsyncStorage.setItem(KEY, JSON.stringify({ allColumns, allImageHeight })).catch(() => {});
}

export const useGridPrefs = create<GridPrefs>((set, get) => ({
  allColumns: DEF_COLS,
  allImageHeight: DEF_IMG,
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as { allColumns?: number; allImageHeight?: number };
        set({
          allColumns: clampCols(v.allColumns ?? DEF_COLS),
          allImageHeight: clampImg(v.allImageHeight ?? DEF_IMG),
          loaded: true,
        });
        return;
      }
    } catch {
      /* fall through to defaults */
    }
    set({ loaded: true });
  },
  setColumns: (n) => {
    const allColumns = clampCols(n);
    set({ allColumns });
    persist(allColumns, get().allImageHeight);
  },
  setImageHeight: (n) => {
    const allImageHeight = clampImg(n);
    set({ allImageHeight });
    persist(get().allColumns, allImageHeight);
  },
}));
