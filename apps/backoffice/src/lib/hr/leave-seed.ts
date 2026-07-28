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

// Pro-rated annual entitlement for a join date, within the join year.
// Nearest 0.5; joins before the year started get the full base.
export function proratedAnnualDays(joinDateISO: string, base: number = ANNUAL_BASE_DAYS): number {
  const join = new Date(`${joinDateISO}T00:00:00Z`);
  if (Number.isNaN(join.getTime())) return base;
  const year = join.getUTCFullYear();
  const yearEnd = Date.UTC(year, 11, 31);
  const daysInYear = (yearEnd - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  const remaining = (yearEnd - join.getTime()) / 86_400_000 + 1;
  const frac = Math.min(1, Math.max(0, remaining / daysInYear));
  return Math.round(base * frac * 2) / 2;
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
