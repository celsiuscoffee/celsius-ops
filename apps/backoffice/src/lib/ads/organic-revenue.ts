/**
 * ORGANIC till revenue — the revenue signal the ads guard is allowed to read.
 *
 * Why this exists (2026-07-23/27). The guard measured TOTAL till, and the SMS
 * lifecycle loop manufactures till by minting discount vouchers. Through the
 * hard-cut window those two moved in opposite directions and cancelled out:
 *
 *   organic (no promo/reward)  RM8,754/day -> RM8,048/day   (-8%)
 *   discounted (SMS vouchers)  RM1,504/day -> RM1,804/day  (+20%)
 *   total                      "flat"  <-- what the guard saw
 *
 * A guard reading the total literally cannot see ad-cut damage while another
 * loop is inflating the same number, so it would keep authorising cuts into a
 * softening till. Organic revenue excludes the orders the loop pays for, which
 * makes the guard measure demand rather than our own discounting.
 *
 * Deliberately a SEPARATE function from `dailyRevenueSeries` (labour-gate):
 * staffing must still be planned against TOTAL revenue — a voucher order takes
 * just as much labour to make. Same shape and sources so it is a drop-in for
 * the guard's actual/forecast/anchor maths.
 *
 * CRITICAL: the guard divides actual by a forecast built from history. Both
 * sides must come from the SAME series, or the ratio compares organic-actual
 * against total-history and breaches instantly. Callers therefore swap the
 * whole series function, never just the numerator.
 */

import { prisma } from "@/lib/prisma";
import { PICKUP_STORE_BY_LOYALTY } from "@/lib/hr/demand";

/**
 * Marketing-driven orders are excluded outright, not discounted-down: the
 * order exists BECAUSE of the voucher, so its full value is loop-manufactured
 * demand, not organic demand that happened to be cheaper.
 *
 * `discount_amount` alone is deliberately NOT a trigger — that is a manual
 * staff discount (goodwill, staff meal, price fix), which is organic demand.
 * Only reward/voucher/promo fields, which is what the loop mints, disqualify.
 */
export async function organicRevenueSeries(
  outlet: { id: string; loyaltyOutletId: string | null },
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const lid = outlet.loyaltyOutletId ?? "";
  const storeId = PICKUP_STORE_BY_LOYALTY[lid] ?? "";
  const rows = await prisma.$queryRaw<Array<{ d: string; revenue: number | null }>>`
    SELECT d::text AS d, sum(rev)::float AS revenue FROM (
      SELECT (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d, sum(total) / 100.0 AS rev
        FROM pos_orders
        WHERE outlet_id = ${lid} AND status = 'completed' AND refund_of_order_id IS NULL
          AND COALESCE(reward_discount_amount, 0) = 0
          AND COALESCE(promo_discount, 0) = 0
          AND reward_id IS NULL
          AND loyalty_voucher_id IS NULL
          AND voucher_code IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
      UNION ALL
      SELECT (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, sum(total) / 100.0
        FROM orders
        WHERE store_id = ${storeId} AND status IN ('completed','ready','collected','paid','preparing')
          AND COALESCE(reward_discount_amount, 0) = 0
          AND COALESCE(promo_discount, 0) = 0
          AND COALESCE(first_order_discount_amount, 0) = 0
          AND reward_id IS NULL
          AND wallet_voucher_id IS NULL
          AND voucher_code IS NULL
          AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
      UNION ALL
      -- Legacy StoreHub till (ended per-outlet Jun 7-17 2026). No reward
      -- columns exist and the SMS loop did not start until Jun 22, so every
      -- StoreHub row predates loop contamination and passes through as-is.
      SELECT (transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date, sum(total)
        FROM storehub_sales
        WHERE outlet_id = ${outlet.id} AND transaction_type = 'Sale' AND COALESCE(is_cancelled, false) = false
          AND (transaction_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
      UNION ALL
      -- Consignment outlets (Nilai, IOI Mall): no till and no ads campaign, so
      -- nothing to filter — kept so the series matches dailyRevenueSeries.
      SELECT biz_date, sum(gross)
        FROM consignment_sales
        WHERE outlet_id = ${outlet.id}
          AND biz_date BETWEEN ${fromDate}::date AND ${toDate}::date
        GROUP BY 1
    ) s GROUP BY d
  `;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.d, Number(r.revenue) || 0);
  return out;
}
