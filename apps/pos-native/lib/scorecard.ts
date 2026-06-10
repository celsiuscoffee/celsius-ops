/**
 * The logged-in cashier's own performance for TODAY — collection rate + pair
 * adds — for the live self-scorecard chip on the register. Read-only, best
 * effort: a failed fetch just leaves the chip hidden, never blocks the till.
 */
import { apiGet } from "@/lib/api";

export type Scorecard = {
  orders: number;
  collected: number;
  rate: number; // 0–100
  pairAdds: number;
  target: number; // collection-rate target (70)
};

export async function getScorecard(
  employeeId: string,
  outletId: string | null,
): Promise<Scorecard | null> {
  try {
    const qs = new URLSearchParams({ employee_id: employeeId });
    if (outletId) qs.set("outlet_id", outletId);
    const res = await apiGet<Scorecard>(`/api/pos/cashier-scorecard?${qs.toString()}`);
    return res ?? null;
  } catch {
    return null;
  }
}
