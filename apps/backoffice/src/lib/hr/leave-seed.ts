// Leave-balance seeding for new hires — shared by BOTH create paths (the
// backoffice create-employee API and the HR agent's create_staff executor),
// so a hire can never again start with zero balance rows (the gap behind the
// 2026-07-28 BrioHR reconciliation: 15 FT staff had no balances at all).
//
// Policy (LOE terms + house convention set 2026-07-28):
//   - annual:  8 days/yr base (<2 yrs service), PRO-RATED by remaining
//     calendar days of the join year, rounded to the nearest half-day —
//     same formula as the fleet backfill.
//   - sick:    14 days flat (<2 yrs) — the LOE says sick leave is NOT
//     prorated (clause B2).
//   - part_time / contract: no paid-leave rows (casual workers; owner can
//     grant individually via backoffice).
// Idempotent: existing rows for the same user/year/type are never touched.

import { Prisma, PrismaClient } from "@prisma/client";

const ANNUAL_BASE_DAYS = 8;
const SICK_DAYS = 14;

type Db = PrismaClient | Prisma.TransactionClient;

// Pro-rated annual entitlement for a join date, within the join year —
// computed the Employment Act 1955 s.60E way (owner 2026-08-21: "follow the
// act accurately"):
//   - proportion is by COMPLETED MONTHS OF SERVICE, not calendar days;
//   - a completed month = a calendar month worked in full, so joining on the
//     1st counts the join month, joining any later day does not;
//   - the result is rounded to WHOLE DAYS, a fraction of one-half or more
//     going UP to a full day (s.60E's rounding rule).
// This replaced the old calendar-day / nearest-half method, which could land
// half a day UNDER the statutory minimum (e.g. a 1 Sep join: old 2.5 vs the
// act's 8×4/12 = 2.67 → 3). Joins before the year started get the full base.
export function proratedAnnualDays(joinDateISO: string, base: number = ANNUAL_BASE_DAYS): number {
  const join = new Date(`${joinDateISO}T00:00:00Z`);
  if (Number.isNaN(join.getTime())) return base;
  const joinMonth = join.getUTCMonth() + 1; // 1–12
  const joinDay = join.getUTCDate();
  // Completed calendar months of service from the join to 31 Dec of the join
  // year. The join month counts only when worked in full (joined on the 1st).
  const completedMonths = Math.min(12, Math.max(0, 12 - joinMonth + (joinDay === 1 ? 1 : 0)));
  // Round half-or-more up to a whole day (Math.round rounds .5 toward +∞).
  return Math.round((base * completedMonths) / 12);
}

/**
 * Seed the join-year leave balances for a newly created employee.
 * No-op for non-full_time employment and for rows that already exist.
 * Returns a short summary for logging/reply text ("" when nothing seeded).
 */
export async function seedLeaveBalancesForHire(
  db: Db,
  userId: string,
  joinDateISO: string,
  employmentType: string,
): Promise<string> {
  if (employmentType !== "full_time") return "";
  const year = new Date(`${joinDateISO}T00:00:00Z`).getUTCFullYear() || new Date().getUTCFullYear();
  const annual = proratedAnnualDays(joinDateISO);

  await db.$executeRaw`
    INSERT INTO hr_leave_balances (user_id, year, leave_type, entitled_days, used_days, pending_days, carried_forward)
    SELECT * FROM (VALUES
      (${userId}, ${year}, 'annual', ${annual}::numeric, 0::numeric, 0::numeric, 0::numeric),
      (${userId}, ${year}, 'sick', ${SICK_DAYS}::numeric, 0::numeric, 0::numeric, 0::numeric)
    ) AS v(user_id, year, leave_type, entitled_days, used_days, pending_days, carried_forward)
    WHERE NOT EXISTS (
      SELECT 1 FROM hr_leave_balances b
      WHERE b.user_id = v.user_id AND b.year = v.year AND b.leave_type = v.leave_type
    )
  `;
  return `leave seeded: ${annual} AL (pro-rated) + ${SICK_DAYS} sick`;
}
