import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Cashier shift open/close for the POS-native register.
 *
 * A shift ties a run of orders to a register + the staff who worked it,
 * so the Z-report / reports can attribute sales correctly. The checkout
 * already auto-attaches the current open shift (lib/checkout.ts →
 * ensureOpenShift); this module gives staff explicit control: open a
 * shift at the start, close it at the end (sets closed_at + rolls up
 * totals). Cashless (QR/card-only) register — no cash float / drawer count.
 *
 * The outlet's active register is resolved the same way checkout does
 * (pos_registers.is_active for the outlet).
 */

export type Shift = {
  id: string;
  outlet_id: string;
  register_id: string;
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
  status: string | null;
  opening_cash: number | null;
  closing_cash: number | null;
  total_sales: number;
  total_orders: number;
};

export type ShiftTotals = { orders: number; sales: number };

async function resolveRegisterId(outletId: string): Promise<string | null> {
  const { data } = await supabase
    .from("pos_registers")
    .select("id")
    .eq("outlet_id", outletId)
    .eq("is_active", true)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function findOpenShift(outletId: string, registerId: string): Promise<Shift | null> {
  const { data } = await supabase
    .from("pos_shifts")
    .select("id, outlet_id, register_id, opened_by, opened_at, closed_at, status, opening_cash, closing_cash, total_sales, total_orders")
    .eq("outlet_id", outletId)
    .eq("register_id", registerId)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Shift | null) ?? null;
}

/** Live sales rollup for a shift, computed from its completed orders
 *  (the pos_shifts.total_* columns aren't incremented per-order, so we
 *  derive them on demand for the summary + close). */
export async function shiftTotals(shiftId: string): Promise<ShiftTotals> {
  const { data } = await supabase
    .from("pos_orders")
    .select("total, status")
    .eq("shift_id", shiftId);
  const rows = (data ?? []) as { total: number | null; status: string }[];
  const completed = rows.filter((r) => r.status === "completed");
  return {
    orders: completed.length,
    sales: completed.reduce((s, r) => s + (r.total ?? 0), 0),
  };
}

export async function openShift(outletId: string, staffId: string): Promise<Shift | null> {
  const registerId = await resolveRegisterId(outletId);
  if (!registerId) {
    console.warn("[shift] no active register for outlet", outletId);
    return null;
  }
  // Re-use an already-open shift rather than stacking a second one.
  const existing = await findOpenShift(outletId, registerId);
  if (existing) return existing;

  // Cashless (QR/card-only) register — no opening cash float.
  const { data, error } = await supabase
    .from("pos_shifts")
    .insert({
      outlet_id: outletId,
      register_id: registerId,
      opened_by: staffId,
      employee_id: staffId,
      status: "open",
    })
    .select("id, outlet_id, register_id, opened_by, opened_at, closed_at, status, opening_cash, closing_cash, total_sales, total_orders")
    .single();
  if (error) {
    console.warn("[shift] openShift failed:", error.message);
    return null;
  }
  return data as Shift;
}

export async function closeShift(shift: Shift, staffId: string): Promise<ShiftTotals | null> {
  const totals = await shiftTotals(shift.id);
  // Cashless (QR/card-only) POS — no cash drawer, so closing just stamps
  // closed_at + rolls up the shift's sales for the Z-Report. No cash count
  // / expected / variance.
  const { error } = await supabase
    .from("pos_shifts")
    .update({
      closed_at: new Date().toISOString(),
      closed_by: staffId,
      status: "closed",
      total_sales: totals.sales,
      total_orders: totals.orders,
    })
    .eq("id", shift.id)
    .is("closed_at", null);
  if (error) {
    console.warn("[shift] closeShift failed:", error.message);
    return null;
  }
  return totals;
}

/** The most recently CLOSED shift for this register, if it closed within the
 *  window (default 6h) — so an accidental/early close can be resumed instead of
 *  starting a fresh shift (which would split the same service across two
 *  Z-reports). */
export async function findRecentClosedShift(outletId: string, withinMin = 360): Promise<Shift | null> {
  const registerId = await resolveRegisterId(outletId);
  if (!registerId) return null;
  const { data } = await supabase
    .from("pos_shifts")
    .select("id, outlet_id, register_id, opened_by, opened_at, closed_at, status, opening_cash, closing_cash, total_sales, total_orders")
    .eq("outlet_id", outletId)
    .eq("register_id", registerId)
    .not("closed_at", "is", null)
    .gte("closed_at", new Date(Date.now() - withinMin * 60_000).toISOString())
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Shift | null) ?? null;
}

/** Reopen a closed shift (clears closed_at) — recovers from an accidental or
 *  too-early close so the run's orders + Z-report stay on one shift. */
export async function reopenShift(shiftId: string): Promise<boolean> {
  const { error } = await supabase
    .from("pos_shifts")
    .update({ closed_at: null, closed_by: null, status: "open" })
    .eq("id", shiftId);
  if (error) { console.warn("[shift] reopenShift failed:", error.message); return false; }
  return true;
}

/** Tracks the outlet register's current open shift. Re-checks on mount
 *  and exposes a manual reload for after open/close. */
export function useShift(outletId: string | null | undefined) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!outletId) { setShift(null); setLoading(false); return; }
    setLoading(true);
    const registerId = await resolveRegisterId(outletId);
    if (!registerId) { setShift(null); setLoading(false); return; }
    const open = await findOpenShift(outletId, registerId);
    setShift(open);
    setLoading(false);
  }, [outletId]);

  useEffect(() => { void reload(); }, [reload]);

  return { shift, loading, reload };
}
