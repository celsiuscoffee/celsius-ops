/**
 * Outlet labels — mirrors packages/shared/src/outlets.ts so the native
 * POS shows the same standardized names as web (no "Conezion" / "Tamarind
 * Square" drift). Keyed by the lowercase Supabase `outlets` id.
 */

// Short label for the login dropdown / register header chip.
export const OUTLET_SHORT: Record<string, string> = {
  "outlet-sa": "Shah Alam",
  "outlet-con": "Putrajaya",
  "outlet-tam": "Tamarind",
  "outlet-nilai": "Nilai",
};

// Full brand name for receipts.
export const OUTLET_FULL: Record<string, string> = {
  "outlet-sa": "Celsius Coffee Shah Alam",
  "outlet-con": "Celsius Coffee Putrajaya",
  "outlet-tam": "Celsius Coffee Tamarind",
  "outlet-nilai": "Celsius Coffee Nilai",
};

export const outletShort = (id: string | null | undefined) =>
  (id && OUTLET_SHORT[id]) || (id ?? "");

export const outletFull = (id: string | null | undefined) =>
  (id && OUTLET_FULL[id]) || "Celsius Coffee";
