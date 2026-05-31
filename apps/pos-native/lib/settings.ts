import { create } from "zustand";
import { supabase } from "./supabase";

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
  default_tax_rate: number | null;
  default_tax_inclusive: boolean | null;
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
  outletId: string | null;
  loading: boolean;
  /** Last load error message (so a settings screen can surface it). */
  error: string | null;
  /** Initial fetch — deduped per outlet (skips if already cached). */
  load: (outletId: string) => Promise<void>;
  /** Force a refetch — reflects backoffice edits without an app restart. */
  refresh: (outletId: string) => Promise<void>;
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  outlet: null,
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
      set({ loading: false, error: settingsRes.error.message });
      return;
    }
    set({
      settings: (settingsRes.data as BranchSettings) ?? null,
      outlet: (outletRes.data as OutletInfo) ?? null,
      loading: false,
    });
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
