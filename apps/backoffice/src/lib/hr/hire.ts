/**
 * ONE provisioning path for a new employee.
 *
 * WHY THIS EXISTS. Three call sites created employees independently — the
 * backoffice form (`api/hr/employees/create`), the LoE bulk import
 * (`api/hr/loe-import/commit`) and the HR agent (`agent/write-ops`
 * `create_staff`) — and they drifted apart. The LoE import, the one used for
 * BULK onboarding, was the thinnest of the three:
 *
 *   - it seeded no leave balances, so every hire started the year with zero
 *     entitlement rows and a broken Leave screen — the same shape as the
 *     2026-07-28 BrioHR reconciliation, where 15 full-timers had none at all;
 *   - it applied no staff-app access preset, so a new barista opened the app
 *     to no tabs;
 *   - it derived no DOB/gender from the IC and set no stations, so checklist
 *     auto-assign could not target them;
 *   - its duplicate gate checked the PHONE only — and a Letter of Employment
 *     almost never carries one, so re-importing the same letter silently
 *     created a second person;
 *   - it had no transaction: a failure after the profile insert left a
 *     half-built employee behind.
 *
 * Everything a new hire needs now happens here, once, atomically:
 *
 *   User (+ access preset, PIN, bank) → hr_employee_profiles →
 *   hr_salary_history → hr_job_history → hr_leave_balances
 *
 * A caller's only job is to authorise the request and map its own shape onto
 * `HireInput`. Callers must NOT re-implement any of the steps above; add the
 * field here instead, so the next path cannot drift.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@celsius/auth";
import { PIN_PATTERN, pinInUse } from "@/lib/hr/pin-policy";
import { applyStaffPreset } from "@/lib/staff-access-presets";
import { seedLeaveBalancesForHire } from "@/lib/hr/leave-seed";
import { normalizeAccountNumber } from "@/lib/hr/bank-account";

export const ROLES = ["STAFF", "MANAGER", "ADMIN", "OWNER"] as const;
export type HireRole = (typeof ROLES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Why a hire was refused. Routes map these onto HTTP status codes. */
export type HireErrorCode = "invalid" | "duplicate" | "pin_taken";

export class HireError extends Error {
  constructor(message: string, readonly code: HireErrorCode) {
    super(message);
    this.name = "HireError";
  }
}

export type HireInput = {
  name: string;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  role: HireRole;
  outletId?: string | null;
  position?: string | null;
  employmentType?: string | null;
  joinDate?: string | null;
  basicSalary?: number | null;
  hourlyRate?: number | null;
  performanceAllowance?: number | null;
  attendanceAllowance?: number | null;
  icNumber?: string | null;
  /** Explicit values win over anything derived from the IC. */
  dateOfBirth?: string | null;
  gender?: string | null;
  epfNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  managerUserId?: string | null;
  /** Plaintext; validated, checked for collisions and hashed in here. */
  pin?: string | null;
  notes?: string | null;
  /** Who is doing the hiring — recorded on the history rows. */
  createdBy?: string | null;
  /** Free text for the audit rows, e.g. "Imported from LoE adam.pdf". */
  salaryComment?: string;
  jobNote?: string;
};

export type HireResult = {
  userId: string;
  /** Human-readable summary of seeded leave, "" when none (non-FT). */
  leaveSeeded: string;
};

export const digitsOnly = (value: string): string => value.replace(/\D/g, "");

const trimmed = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out === "" ? null : out;
};

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * DOB + gender from a Malaysian IC (century rule YY≤26 → 20YY; last digit
 * odd = male). Returns nulls rather than guessing when the IC is malformed.
 */
export function icDerive(icRaw: string): { dob: string | null; gender: string | null } {
  const ic = digitsOnly(icRaw);
  if (ic.length !== 12) return { dob: null, gender: null };
  const yy = Number(ic.slice(0, 2));
  const y = yy <= 26 ? 2000 + yy : 1900 + yy;
  const m = Number(ic.slice(2, 4));
  const d = Number(ic.slice(4, 6));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { dob: null, gender: null };
  }
  return { dob: date.toISOString().slice(0, 10), gender: Number(ic[11]) % 2 === 1 ? "M" : "F" };
}

/** Which stations a position works, for checklist auto-assign. */
export function stationsFor(position: string): string[] {
  const p = position.toLowerCase();
  const boh = p.includes("kitchen") || p.includes("chef") || p.includes("boh");
  const foh = p.includes("barista") || p.includes("cashier") || (!boh && !p.includes("lead"));
  const out: string[] = [];
  if (foh) out.push("foh");
  if (boh) out.push("boh");
  if (p.includes("lead") || p.includes("supervisor")) out.push("lead");
  return out.length ? out : ["foh"];
}

const isoOrToday = (value: unknown): string => {
  const s = trimmed(value);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
};

/**
 * Anyone already on file who looks like this person. Matched on phone, email
 * or IC — each normalised, and each skipped when the input doesn't carry it.
 * An LoE rarely carries a phone, which is exactly why matching on the IC
 * matters: it is the one identifier a letter always prints.
 */
export async function findDuplicates(
  input: Pick<HireInput, "phone" | "email" | "icNumber">,
): Promise<Array<{ name: string; status: string }>> {
  const phone = trimmed(input.phone);
  const email = trimmed(input.email)?.toLowerCase() ?? null;
  const ic = trimmed(input.icNumber);
  if (!phone && !email && !ic) return [];

  return prisma.$queryRaw<Array<{ name: string; status: string }>>`
    SELECT u.name, u.status::text
    FROM "User" u
    LEFT JOIN hr_employee_profiles p ON p.user_id = u.id
    WHERE (${phone}::text IS NOT NULL
           AND coalesce(u.phone, '') <> ''
           AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = ${digitsOnly(phone ?? "")})
       OR (${email}::text IS NOT NULL AND lower(coalesce(u.email, '')) = ${email})
       OR (${ic}::text IS NOT NULL
           AND coalesce(p.ic_number, '') <> ''
           AND regexp_replace(coalesce(p.ic_number, ''), '[^0-9]', '', 'g') = ${digitsOnly(ic ?? "")})
    LIMIT 3
  `;
}

/**
 * Everything that can be judged without touching the database. Returns the
 * complaint, or null when the input is sound.
 */
export function validateHire(input: HireInput): string | null {
  if (!trimmed(input.name)) return "name is required";
  if (!ROLES.includes(input.role)) return `Invalid role: ${String(input.role)}`;

  const employmentType = resolveEmploymentType(input.employmentType);
  const basicSalary = numberOrNull(input.basicSalary);
  const hourlyRate = numberOrNull(input.hourlyRate);

  // The payroll calculator skips a full-timer with no basic salary and a
  // part-timer with no hourly rate, so a hire missing one is a silently
  // unpayable employee — caught here rather than at the first run. The field
  // must be PRESENT, not non-zero: an unpaid HQ record is a real thing, and
  // `schedule_required = false` exempts it from the preflight's block. Typing
  // 0 says that on purpose; leaving it blank is the accident worth refusing.
  if (employmentType === "full_time" && basicSalary === null) {
    return "full-time requires a basic salary (enter 0 only if they are genuinely unpaid)";
  }
  if (employmentType === "part_time" && hourlyRate === null) {
    return "part-time requires an hourly rate";
  }

  const pin = trimmed(input.pin);
  if (pin && !PIN_PATTERN.test(pin)) return "PIN must be exactly 6 digits";

  const account = trimmed(input.bankAccountNumber);
  if (account && !normalizeAccountNumber(account)) {
    return "Bank account number must be digits only";
  }
  return null;
}

function resolveEmploymentType(value: unknown): EmploymentType {
  const s = trimmed(value);
  return (EMPLOYMENT_TYPES as readonly string[]).includes(s ?? "")
    ? (s as EmploymentType)
    : "full_time";
}

/**
 * Create the employee and everything that must exist alongside them.
 *
 * Runs as ONE transaction: either the whole hire lands or none of it does.
 * That is the difference from the old per-route code, which created the User
 * first and then tried to undo it by hand when a later insert failed.
 *
 * Call this sequentially when importing a batch — each hire commits before
 * the next is checked, so a PIN, phone, email or IC repeated WITHIN the batch
 * is caught by the same gates that catch a clash with an existing employee.
 */
export async function hireEmployee(input: HireInput): Promise<HireResult> {
  const complaint = validateHire(input);
  if (complaint) throw new HireError(complaint, "invalid");

  const name = trimmed(input.name)!;
  const position = trimmed(input.position);
  const employmentType = resolveEmploymentType(input.employmentType);
  const joinDate = isoOrToday(input.joinDate);
  const basicSalary = numberOrNull(input.basicSalary) ?? 0;
  const hourlyRate = numberOrNull(input.hourlyRate);
  const ic = trimmed(input.icNumber);
  const pin = trimmed(input.pin);

  const duplicates = await findDuplicates(input);
  if (duplicates.length > 0) {
    throw new HireError(
      `Already on file: ${duplicates.map((d) => `${d.name} (${d.status})`).join(", ")} — update that record instead of creating a duplicate`,
      "duplicate",
    );
  }

  // PIN logins share ONE namespace across every account, so a collision makes
  // the new hire log in as somebody else.
  if (pin && (await pinInUse(pin))) {
    throw new HireError(
      "That PIN is already used by another account — choose a different one",
      "pin_taken",
    );
  }

  const derived = ic ? icDerive(ic) : { dob: null, gender: null };
  const dateOfBirth = trimmed(input.dateOfBirth) ?? derived.dob;
  const gender = trimmed(input.gender) ?? derived.gender;
  const stations = stationsFor(position ?? "");
  const access = applyStaffPreset({ appAccess: [], moduleAccess: {} }, position);
  const pinHash = pin ? await hashPin(pin) : null;
  const bankAccountNumber = trimmed(input.bankAccountNumber)
    ? normalizeAccountNumber(trimmed(input.bankAccountNumber)!)
    : null;
  const createdBy = trimmed(input.createdBy);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        fullName: trimmed(input.fullName),
        phone: trimmed(input.phone),
        email: trimmed(input.email),
        role: input.role,
        outletId: trimmed(input.outletId),
        status: "ACTIVE",
        appAccess: access.appAccess,
        moduleAccess: access.moduleAccess as Prisma.InputJsonValue,
        pin: pinHash,
        bankName: trimmed(input.bankName),
        bankAccountNumber,
        // Default the account holder to the legal name. The weekly preflight
        // compares the two and BLOCKS a mismatch — a blank holder only makes
        // that check unverifiable, which helps nobody.
        bankAccountName: trimmed(input.bankAccountName) ?? trimmed(input.fullName),
      },
      select: { id: true },
    });

    // A part-timer's basic_salary is forced to 0: the monthly calculator pays
    // whatever sits in that column, so a stray figure on an hourly employee
    // would pay them twice. An hourly rate is stored whenever it is given,
    // because contract staff can be hourly too.
    await tx.$executeRaw`
      INSERT INTO hr_employee_profiles
        (user_id, position, employment_type, join_date, basic_salary, hourly_rate,
         performance_allowance_amount, attendance_allowance_amount,
         epf_number, ic_number, date_of_birth, gender, nationality,
         stations, manager_user_id, notes, created_at, updated_at)
      VALUES
        (${user.id}, ${position}, ${employmentType}, ${joinDate}::date,
         ${employmentType === "part_time" ? 0 : basicSalary},
         ${hourlyRate},
         ${numberOrNull(input.performanceAllowance)},
         ${numberOrNull(input.attendanceAllowance)},
         ${trimmed(input.epfNumber)}, ${ic}, ${dateOfBirth}::date, ${gender}, 'Malaysian',
         ${stations}::text[], ${trimmed(input.managerUserId)},
         ${trimmed(input.notes)}, now(), now())
    `;

    await tx.$executeRaw`
      INSERT INTO hr_salary_history
        (user_id, effective_date, salary_type, amount, comment, created_by, created_at)
      VALUES
        (${user.id}, ${joinDate}::date,
         ${employmentType === "part_time" ? "hourly" : "monthly"},
         ${employmentType === "part_time" ? (hourlyRate ?? 0) : basicSalary},
         ${input.salaryComment ?? "Initial salary on hire"}, ${createdBy}, now())
    `;

    await tx.$executeRaw`
      INSERT INTO hr_job_history
        (user_id, effective_date, job_title, outlet_id, manager_user_id,
         employment_type, note, created_by, created_at)
      VALUES
        (${user.id}, ${joinDate}::date, ${position ?? input.role},
         ${trimmed(input.outletId)}, ${trimmed(input.managerUserId)}, ${employmentType},
         ${input.jobNote ?? "Initial hire"}, ${createdBy}, now())
    `;

    // Full-timers start with join-year balances so the staff app's Leave
    // screen works on day one. Inside the transaction on purpose: a hire
    // without entitlements is the bug this module exists to prevent, so it
    // must not be able to half-succeed.
    const leaveSeeded = await seedLeaveBalancesForHire(tx, user.id, joinDate, employmentType);

    return { userId: user.id, leaveSeeded };
  });
}
