import { create } from "zustand";
import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * POS branch settings — the backoffice (apps/backoffice → POS Settings)
 * is the canonical editor; it writes the `pos_branch_settings` row per
 * outlet. The POS terminal (web AND this native app) READS that same row
 * at runtime via the anon client and reflects whatever the backoffice set
 * — service charge, default order type, product grid columns, receipt /
 * QR / promo config, and tax + LHDN e-Invoice defaults.
 *
 * This mirrors apps/pos/src/lib/pos-context.tsx (fetchBranchSettings) so
 * the native register behaves identically to the web register.
 */

export type BranchSettings = {
  outlet_id: string;
  service_charge_rate: number | null;
  default_order_type: string | null;
  checkout_option: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  receipt_show_logo: boolean | null;
  receipt_qr_url: string | null;
  receipt_qr_label: string | null;
  receipt_promo_enabled: boolean | null;
  receipt_promo_text: string | null;
  ghl_merchant_id: string | null;
  ghl_terminal_id: string | null;
  grid_columns: number | null;
  layout_mode: string | null;
  // How many dine-in tables this outlet has. Drives the live Tables
  // panel on the POS-native register + the BO Table QR generator.
  table_count: number | null;
  // Visual floor-plan table layout (set in BO POS Settings). Each floor carries
  // positioned tables ([{label,seats,x,y,shape}]); a legacy comma-separated
  // string is still accepted. Empty → fall back to table_count.
  table_layout: { name?: string; tables?: unknown }[] | null;
  default_tax_rate: number | null;
  default_tax_inclusive: boolean | null;
  // Per-outlet SST (checkout tax). Each outlet sets its own on/off + rate;
  // every channel charges the ORDERING outlet's SST. rate is a fraction
  // (0.06 = 6%).
  sst_enabled: boolean | null;
  sst_rate: number | null;
  einvoice_tin: string | null;
  einvoice_brn: string | null;
  einvoice_sst_no: string | null;
};

/** Outlet master data for the receipt header (name + address + phone). */
export type OutletInfo = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
};

type SettingsState = {
  settings: BranchSettings | null;
  outlet: OutletInfo | null;
  /** This outlet's SST — sourced from its pos_branch_settings row
   *  (sst_enabled / sst_rate), so each outlet charges its own tax. The
   *  pickup/order app reads the same per-outlet row at checkout. */
  sst: { rate: number; enabled: boolean };
  outletId: string | null;
  loading: boolean;
  /** Last load error message (so a settings screen can surface it). */
  error: string | null;
  /** Initial fetch — deduped per outlet (skips if already cached). */
  load: (outletId: string) => Promise<void>;
  /** Force a refetch — reflects backoffice edits without an app restart. */
  refresh: (outletId: string) => Promise<void>;
};

// Cold-boot offline cache for the per-outlet settings (SST + receipt config).
const SETTINGS_CACHE_PREFIX = "pos.settings.cache.v1.";
type CachedSettings = { settings: BranchSettings | null; outlet: OutletInfo | null; sst: { rate: number; enabled: boolean } };
async function saveSettingsCache(outletId: string, c: CachedSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_CACHE_PREFIX + outletId, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
async function loadSettingsCache(outletId: string): Promise<CachedSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_CACHE_PREFIX + outletId);
    return raw ? (JSON.parse(raw) as CachedSettings) : null;
  } catch {
    return null;
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  outlet: null,
  sst: { rate: 0.06, enabled: true },
  outletId: null,
  loading: false,
  error: null,
  load: async (outletId: string) => {
    // Initial load only — skip a redundant refetch for the same outlet.
    // Live updates flow through refresh() (register focus + realtime), so a
    // backoffice edit to pos_branch_settings reaches a running POS.
    if (get().outletId === outletId && get().settings) return;
    await get().refresh(outletId);
  },
  refresh: async (outletId: string) => {
    set({ loading: true, error: null, outletId });
    // Pull the BO-managed settings row + the outlet master (for the
    // receipt header) together.
    const [settingsRes, outletRes] = await Promise.all([
      supabase.from("pos_branch_settings").select("*").eq("outlet_id", outletId).maybeSingle(),
      supabase.from("outlets").select("name, address, city, state, phone").eq("id", outletId).maybeSingle(),
    ]);
    if (settingsRes.error) {
      // Offline / DB unreachable → fall back to the last cached settings so a
      // cold reboot mid-outage still has SST + receipt config instead of bare
      // defaults. Keep whatever's already in memory if present.
      if (!get().settings) {
        const cached = await loadSettingsCache(outletId);
        if (cached) {
          set({ settings: cached.settings, outlet: cached.outlet, sst: cached.sst, loading: false, error: settingsRes.error.message });
          return;
        }
      }
      set({ loading: false, error: settingsRes.error.message });
      return;
    }
    const branch = (settingsRes.data as BranchSettings) ?? null;
    // SST is per-outlet now: read this outlet's sst_enabled / sst_rate off the
    // branch row. No branch row (or unset) → SST off (safe default). Because it
    // lives on pos_branch_settings, the register's existing realtime listener
    // on that table already pushes a backoffice SST change to the live till.
    const outletInfo = (outletRes.data as OutletInfo) ?? null;
    const sst = {
      rate: typeof branch?.sst_rate === "number" ? branch.sst_rate : 0.06,
      enabled: branch?.sst_enabled === true,
    };
    set({ settings: branch, outlet: outletInfo, sst, loading: false });
    void saveSettingsCache(outletId, { settings: branch, outlet: outletInfo, sst });
  },
}));

// ─── Derived helpers ──────────────────────────────────────
// Small accessors so callers don't reach into the raw row everywhere and
// so defaults live in one place (matching the web register's fallbacks).

export function gridColumns(s: BranchSettings | null): number {
  const n = s?.grid_columns ?? 4;
  return n >= 3 && n <= 8 ? n : 4;
}

export function serviceChargeRate(s: BranchSettings | null): number {
  return s?.service_charge_rate ?? 0;
}

export function defaultOrderType(s: BranchSettings | null): "dine_in" | "takeaway" {
  return s?.default_order_type === "dine_in" ? "dine_in" : "takeaway";
}

/** How many dine-in tables this outlet has. Drives the live Tables panel
 *  on the register + matches the BO Table QR generator. Clamped to a
 *  sane range so a misconfigured row can't render 10,000 tiles. */
export function tableCount(s: BranchSettings | null): number {
  const n = s?.table_count ?? 10;
  return n >= 1 && n <= 100 ? n : 10;
}

export type TableShape = "square" | "round";
export type TableOrient = "h" | "v";
export type TableDef = { label: string; seats: number | null; x: number; y: number; shape: TableShape; orientation: TableOrient };
export type TableZoneInput = { name: string; tables: TableDef[] };

const clamp01 = (v: number, def: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : def);
const posInt = (v: unknown): number | null => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** Auto grid position for tables without an explicit x/y (legacy / fallback). */
function gridPos(i: number, n: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const col = i % cols, row = Math.floor(i / cols);
  return {
    x: cols <= 1 ? 0.5 : 0.1 + (col * 0.8) / (cols - 1),
    y: rows <= 1 ? 0.5 : 0.12 + (row * 0.76) / (rows - 1),
  };
}

/** Resolve the outlet's table layout into floors of positioned tables for the
 *  register floor-plan. Accepts positioned objects OR a legacy comma string
 *  ("1:2, 2:4", auto-gridded); empty → a single "Tables" floor of
 *  T1..table_count, auto-gridded. */
export function tableZones(s: BranchSettings | null): TableZoneInput[] {
  const layout = s?.table_layout;
  if (Array.isArray(layout) && layout.length > 0) {
    const zones = layout
      .map((z) => {
        const name = (typeof z?.name === "string" && z.name.trim()) || "Tables";
        if (Array.isArray(z?.tables)) {
          const tables: TableDef[] = (z.tables as Record<string, unknown>[]).map((t, i) => ({
            label: String(t?.label ?? i + 1),
            seats: posInt(t?.seats),
            x: clamp01(Number(t?.x), 0.5),
            y: clamp01(Number(t?.y), 0.5),
            shape: t?.shape === "round" ? "round" : "square",
            orientation: (t?.orientation === "v" ? "v" : "h") as TableOrient,
          }));
          return { name, tables };
        }
        const toks = String(z?.tables ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        const tables: TableDef[] = toks.map((tok, i) => {
          const [label, seatsRaw] = tok.split(":");
          return { label: (label ?? "").trim() || String(i + 1), seats: posInt(seatsRaw), ...gridPos(i, toks.length), shape: "square" as TableShape, orientation: "h" as TableOrient };
        });
        return { name, tables };
      })
      .filter((z) => z.tables.length > 0);
    if (zones.length > 0) return zones;
  }
  const count = tableCount(s);
  const tables: TableDef[] = Array.from({ length: count }, (_, i) => ({ label: `T${i + 1}`, seats: null, ...gridPos(i, count), shape: "square" as TableShape, orientation: "h" as TableOrient }));
  return [{ name: "Tables", tables }];
}

/** Receipt config shape consumed by lib/printer.ts → the native module. */
export function receiptConfig(s: BranchSettings | null) {
  return {
    showLogo: s?.receipt_show_logo !== false,
    qrUrl: s?.receipt_qr_url || "",
    qrLabel: s?.receipt_qr_label || "",
    promoEnabled: s?.receipt_promo_enabled === true,
    promoText: s?.receipt_promo_text || "",
    receiptHeader: s?.receipt_header || "",
    receiptFooter: s?.receipt_footer || "",
  };
}
