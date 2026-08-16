// HR Ops Agent stage 2 — the WRITE layer. Design: docs/design/hr-ops-agent.md.
//
// Guardrails live HERE, in code — never in the prompt:
//   1. Fixed allowlist of typed operations; the model can only fill in
//      parameters. No free-form SQL exists anywhere in this layer.
//   2. Authority matrix (OP_RULES): who may request each operation, and whose
//      phone must send CONFIRM before it executes. Salary changes always
//      confirm with the OWNER; a plain manager's changes confirm with the HOO;
//      bank details never move on a staff-persona message (that tool doesn't
//      exist in the staff toolset at all).
//   3. Target resolution must land on EXACTLY ONE person (dedup lessons:
//      Absah, Adib, the two Farahs) — ambiguity is returned to the model to
//      disambiguate with the human, never guessed.
//   4. Rate limits: ≤8 executed writes/hour per requester, ≤20 global.
//   5. Every execution mirrors the transaction shapes applied manually in the
//      2026-07 onboarding arc (User + profile + salary/job history atomically;
//      history segments close/open on conversions — never overwritten).

import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@celsius/auth";
import { applyStaffPreset } from "@/lib/staff-access-presets";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { seedLeaveBalancesForHire } from "@/lib/hr/leave-seed";

export type ActionType =
  | "create_staff"
  | "update_details"
  | "convert_employment"
  | "reactivate"
  | "resign"
  | "assignment"
  | "set_pin"
  | "salary_change";

// Informal branch names on hiring paperwork → real Outlet rows (learned:
// STATE.md 2026-07-16). Extend as new aliases are clarified.
export const OUTLET_ALIASES: Record<string, string> = {
  cyberjaya: "Celsius Coffee Tamarind",
  ioi: "Celsius Coffee IOI Mall",
  "ioi mall": "Celsius Coffee IOI Mall",
  putrajaya: "Celsius Coffee Putrajaya",
  conezion: "Celsius Coffee Putrajaya",
  "shah alam": "Celsius Coffee Shah Alam",
  tamarind: "Celsius Coffee Tamarind",
  nilai: "Celsius Coffee Nilai",
};

export interface Requester {
  id: string;
  name: string;
  role: string; // OWNER | ADMIN | MANAGER
  isHOO: boolean;
}

export interface StaffTarget {
  id: string;
  name: string;
  fullName: string | null;
  status: string;
  outletId: string | null;
  outletName: string | null;
  position: string | null;
  employmentType: string | null;
}

const digitsOnly = (s: string) => s.replace(/[^0-9]/g, "");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const mytToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

// The HOO is a MANAGER-role user whose HR position marks them head of
// department/operations (Ariff). Role alone can't distinguish them.
export async function isHOOUser(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ position: string | null }>>`
    SELECT position FROM hr_employee_profiles WHERE user_id = ${userId}
  `;
  return /head of/i.test(rows[0]?.position ?? "");
}

export async function resolveHOOUserRow(): Promise<{ id: string; phone: string | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; phone: string | null }>>`
    SELECT u.id, u.phone FROM "User" u
    JOIN hr_employee_profiles p ON p.user_id = u.id
    WHERE u.status = 'ACTIVE' AND u.role = 'MANAGER' AND p.position ILIKE '%head of%'
    ORDER BY u."createdAt" LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function resolveOwnerUser(): Promise<{ id: string; phone: string | null } | null> {
  const row = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, phone: true },
  });
  return row;
}

// ── Target resolution (must be unambiguous) ──────────────────────────────────

export async function resolveStaffTarget(
  ref: { name?: string; ic?: string; phone?: string },
  opts: { includeDeactivated?: boolean } = {},
): Promise<{ target?: StaffTarget; candidates?: string[]; error?: string }> {
  const name = (ref.name ?? "").trim();
  const ic = digitsOnly(ref.ic ?? "");
  const phone = digitsOnly(ref.phone ?? "");
  if (!name && !ic && !phone) return { error: "need a name, IC, or phone to identify the staff" };

  const rows = await prisma.$queryRaw<
    Array<{
      id: string; name: string; full_name: string | null; status: string;
      outlet_id: string | null; outlet: string | null; position: string | null;
      employment_type: string | null; ic_digits: string; phone_digits: string;
    }>
  >`
    SELECT u.id, u.name, u."fullName" AS full_name, u.status::text,
           u."outletId" AS outlet_id, o.name AS outlet, p.position, p.employment_type,
           regexp_replace(coalesce(p.ic_number,''),'[^0-9]','','g') AS ic_digits,
           regexp_replace(coalesce(u.phone,''),'[^0-9]','','g') AS phone_digits
    FROM "User" u
    LEFT JOIN hr_employee_profiles p ON p.user_id = u.id
    LEFT JOIN "Outlet" o ON o.id = u."outletId"
    WHERE u.role = 'STAFF'
      ${opts.includeDeactivated ? Prisma.empty : Prisma.sql`AND u.status = 'ACTIVE'`}
      AND (
        (${name} <> '' AND (u.name ILIKE ${"%" + name + "%"} OR coalesce(u."fullName",'') ILIKE ${"%" + name + "%"}))
        OR (${ic} <> '' AND regexp_replace(coalesce(p.ic_number,''),'[^0-9]','','g') = ${ic})
        OR (${phone} <> '' AND regexp_replace(coalesce(u.phone,''),'[^0-9]','','g') LIKE ${"%" + phone.slice(-9)})
      )
    LIMIT 6
  `;
  // An IC or phone hit is authoritative; name hits must be unique.
  const exact = rows.filter(
    (r) => (ic && r.ic_digits === ic) || (phone && phone.length >= 9 && r.phone_digits.endsWith(phone.slice(-9))),
  );
  const pool = exact.length === 1 ? exact : rows;
  if (pool.length === 0) return { error: "no matching staff found" };
  if (pool.length > 1) {
    return {
      candidates: pool.map((r) => `${r.name} (${r.full_name ?? "?"}, ${r.outlet ?? "no outlet"}, ${r.status})`),
      error: "more than one match — ask which person is meant (full name / IC / outlet)",
    };
  }
  const r = pool[0];
  return {
    target: {
      id: r.id, name: r.name, fullName: r.full_name, status: r.status,
      outletId: r.outlet_id, outletName: r.outlet, position: r.position,
      employmentType: r.employment_type,
    },
  };
}

export async function resolveOutlet(nameRaw: string): Promise<{ id: string; name: string } | null> {
  const key = nameRaw.trim().toLowerCase();
  const canonical = OUTLET_ALIASES[key] ?? nameRaw.trim();
  const row = await prisma.outlet.findFirst({
    where: { name: { contains: canonical.replace(/^celsius coffee\s*/i, ""), mode: "insensitive" } },
    select: { id: true, name: true },
  });
  return row;
}

// ── Authority matrix ─────────────────────────────────────────────────────────
// confirmer: whose phone must reply CONFIRM. "self" still requires the
// requester to send the code — the echo-confirm is never skipped.

type ConfirmerKind = "self" | "hoo" | "owner";

const OP_RULES: Record<ActionType, { minRole: "MANAGER" | "HOO" | "OWNER"; confirmer: (req: Requester) => ConfirmerKind }> = {
  create_staff: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  update_details: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  convert_employment: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  reactivate: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  resign: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  assignment: { minRole: "MANAGER", confirmer: (r) => (r.role === "OWNER" || r.isHOO ? "self" : "hoo") },
  set_pin: { minRole: "MANAGER", confirmer: () => "self" },
  // Money moves: the owner confirms unless the owner is asking (two-person
  // rule; owner alone may bypass). Applies to salary AND bank-detail changes —
  // update_details payloads carrying bank fields are escalated to this rule.
  salary_change: { minRole: "HOO", confirmer: (r) => (r.role === "OWNER" ? "self" : "owner") },
};

export interface AuthzResult {
  allowed: boolean;
  confirmer: ConfirmerKind;
  reason?: string;
}

export async function authorize(
  action: ActionType,
  requester: Requester,
  target: StaffTarget | null,
  payload: Record<string, unknown>,
): Promise<AuthzResult> {
  const roleRank = requester.role === "OWNER" ? 3 : requester.isHOO ? 2 : requester.role === "MANAGER" || requester.role === "ADMIN" ? 1 : 0;
  if (roleRank === 0) return { allowed: false, confirmer: "self", reason: "staff cannot request ops changes" };

  // Bank-detail edits inside update_details escalate to the money rule.
  const touchesBank = action === "update_details" && !!(payload.bankAccountNumber || payload.bankName || payload.bankAccountName);
  const effective: ActionType = touchesBank ? "salary_change" : action;

  const rule = OP_RULES[effective];
  const minRank = rule.minRole === "OWNER" ? 3 : rule.minRole === "HOO" ? 2 : 1;
  if (roleRank < minRank) {
    return { allowed: false, confirmer: "self", reason: `${effective} needs ${rule.minRole} level` };
  }

  // Subtree rule: a plain manager may only act on their own reporting subtree.
  if (target && roleRank === 1) {
    const visible = await resolveVisibleUserIds({ role: "MANAGER", id: requester.id });
    if (visible !== null && !visible.includes(target.id)) {
      return { allowed: false, confirmer: "self", reason: `${target.name} is not in your team` };
    }
  }
  return { allowed: true, confirmer: rule.confirmer(requester) };
}

// ── Rate limits ──────────────────────────────────────────────────────────────

export async function checkRateLimit(requesterId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ mine: bigint; all: bigint }>>`
    SELECT count(*) FILTER (WHERE meta->>'requestedById' = ${requesterId}) AS mine, count(*) AS all
    FROM agent_actions
    WHERE agent_key = 'hr_ops_agent' AND kind = 'write_executed' AND at > now() - interval '1 hour'
  `;
  if (Number(rows[0]?.all ?? 0) >= 20) return "hourly write limit reached (global) — try again later";
  if (Number(rows[0]?.mine ?? 0) >= 8) return "hourly write limit reached for you — try again later";
  return null;
}

export function newConfirmCode(): string {
  // 4 chars, unambiguous alphabet (no 0/O/1/I), ~410k combinations, single-use
  // + 15-min expiry + confirmer-phone check make brute force over WhatsApp moot.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ── Executors ────────────────────────────────────────────────────────────────
// Each returns a short human summary for the WhatsApp reply. Throws on
// validation failure — callers surface the message, nothing partial commits.

export async function executeAction(action: ActionType, payload: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "create_staff": return execCreateStaff(payload);
    case "update_details": return execUpdateDetails(payload);
    case "convert_employment": return execConvertEmployment(payload);
    case "reactivate": return execReactivate(payload);
    case "resign": return execResign(payload);
    case "assignment": return execAssignment(payload);
    case "set_pin": return execSetPin(payload);
    case "salary_change": return execSalaryChange(payload);
    default: throw new Error(`unknown action ${action satisfies never}`);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const isoOrToday = (v: unknown) => {
  const s = str(v);
  if (!s) return mytToday();
  if (!ISO_DATE.test(s)) throw new Error(`date must be YYYY-MM-DD, got "${s}"`);
  return s;
};

// DOB + gender from a Malaysian IC (century rule YY≤26 → 20YY; last digit odd=M).
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

async function execCreateStaff(p: Record<string, unknown>): Promise<string> {
  const name = str(p.name);
  const position = str(p.position) || "Barista";
  const employmentType = str(p.employmentType) === "full_time" ? "full_time" : "part_time";
  const outletName = str(p.outletName);
  if (!name) throw new Error("name required");
  if (!outletName) throw new Error("outlet required");
  const outlet = await resolveOutlet(outletName);
  if (!outlet) throw new Error(`no outlet matching "${outletName}"`);

  const phone = str(p.phone) || null;
  const email = str(p.email) || null;
  const ic = str(p.ic) || null;

  // Dedup gate — the person may already exist (Absah lesson). Overriding
  // requires the human to change identifiers, not the agent to force through.
  const dupes = await prisma.$queryRaw<Array<{ name: string; status: string }>>`
    SELECT u.name, u.status::text FROM "User" u
    LEFT JOIN hr_employee_profiles pr ON pr.user_id = u.id
    WHERE (${phone}::text IS NOT NULL AND regexp_replace(coalesce(u.phone,''),'[^0-9]','','g') = ${digitsOnly(phone ?? "")} AND coalesce(u.phone,'') <> '')
       OR (${email}::text IS NOT NULL AND u.email = ${email})
       OR (${ic}::text IS NOT NULL AND regexp_replace(coalesce(pr.ic_number,''),'[^0-9]','','g') = ${digitsOnly(ic ?? "")})
    LIMIT 3
  `;
  if (dupes.length > 0) {
    throw new Error(`possible existing record: ${dupes.map((d) => `${d.name} (${d.status})`).join(", ")} — update that record instead of creating a duplicate`);
  }

  const hourlyRate = num(p.hourlyRate);
  const basicSalary = num(p.basicSalary);
  if (employmentType === "part_time" && hourlyRate === null) throw new Error("part_time needs hourlyRate");
  if (employmentType === "full_time" && basicSalary === null) throw new Error("full_time needs basicSalary");

  const joinDate = isoOrToday(p.joinDate);
  const { dob, gender } = ic ? icDerive(ic) : { dob: null, gender: null };
  const stations = stationsFor(position);
  const access = applyStaffPreset({ appAccess: [], moduleAccess: {} }, position);
  const pinHash = str(p.pin) ? await hashPin(str(p.pin)) : null;
  const bankName = str(p.bankName) || null;
  const bankAcc = str(p.bankAccountNumber) ? digitsOnly(str(p.bankAccountNumber)) : null;
  const managerId = str(p.managerUserId) || null;
  const perfAllow = num(p.performanceAllowance);
  const attAllow = num(p.attendanceAllowance);

  const createdRes = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name,
        fullName: str(p.fullName) || null,
        phone,
        email,
        role: "STAFF",
        outletId: outlet.id,
        status: "ACTIVE",
        appAccess: access.appAccess,
        moduleAccess: access.moduleAccess as Prisma.InputJsonValue,
        pin: pinHash,
        bankName,
        bankAccountNumber: bankAcc,
        bankAccountName: str(p.bankAccountName) || str(p.fullName) || null,
      },
      select: { id: true },
    });
    await tx.$executeRaw`
      INSERT INTO hr_employee_profiles
        (user_id, position, employment_type, join_date, basic_salary, hourly_rate,
         performance_allowance_amount, attendance_allowance_amount,
         epf_number, ic_number, date_of_birth, gender, nationality, epf_category,
         payroll_cadence, statutory_applicable, stations, manager_user_id, notes, created_at, updated_at)
      VALUES
        (${created.id}, ${position}, ${employmentType}, ${joinDate}::date,
         ${employmentType === "full_time" ? basicSalary : 0}, ${employmentType === "part_time" ? hourlyRate : null},
         ${perfAllow}, ${attAllow},
         ${str(p.epf) || null}, ${ic}, ${dob}::date, ${gender}, 'Malaysian', 'A',
         'MONTHLY', false, ${stations}::text[], ${managerId},
         ${str(p.notes) || null}, now(), now())
    `;
    await tx.$executeRaw`
      INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
      VALUES (${created.id}, ${joinDate}::date,
              ${employmentType === "part_time" ? "hourly" : "monthly"},
              ${employmentType === "part_time" ? hourlyRate : basicSalary},
              'Initial salary on hire (HR agent)', now())
    `;
    await tx.$executeRaw`
      INSERT INTO hr_job_history (user_id, effective_date, job_title, outlet_id, manager_user_id, employment_type, note, created_at)
      VALUES (${created.id}, ${joinDate}::date, ${position}, ${outlet.id}, ${managerId}, ${employmentType}, 'Initial hire (HR agent)', now())
    `;
    // FT hires start with join-year leave balances (pro-rated AL + flat sick)
    // so the staff app's Leave screen works from day one.
    const seeded = await seedLeaveBalancesForHire(tx, created.id, joinDate, employmentType);
    return { id: created.id, seeded };
  });

  return `✅ ${name} created — ${position} (${employmentType === "part_time" ? `PT RM${hourlyRate}/hr` : `FT RM${basicSalary}/mo`}) at ${outlet.name}, join ${joinDate}${pinHash ? ", PIN set" : ""}${bankAcc ? ", bank on file" : ", bank still needed"}${createdRes.seeded ? `, ${createdRes.seeded}` : ""} (id ${createdRes.id.slice(0, 8)})`;
}

const UPDATABLE_USER_FIELDS = ["email", "phone", "bankName", "bankAccountNumber", "bankAccountName"] as const;
const UPDATABLE_PROFILE_FIELDS = [
  "epf_number", "ic_number", "emergency_contact_name", "emergency_contact_phone",
  "personal_email", "address_line1", "address_city", "address_state", "address_postcode",
] as const;

async function execUpdateDetails(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  if (!targetId) throw new Error("targetId required");
  const userData: Record<string, string> = {};
  for (const f of UPDATABLE_USER_FIELDS) if (str(p[f])) userData[f] = f === "bankAccountNumber" ? digitsOnly(str(p[f])) : str(p[f]);
  const profilePairs: Array<[string, string]> = [];
  for (const f of UPDATABLE_PROFILE_FIELDS) if (str(p[f])) profilePairs.push([f, str(p[f])]);
  if (str(p.pin)) userData.pin = await hashPin(str(p.pin));
  if (Object.keys(userData).length === 0 && profilePairs.length === 0) throw new Error("nothing to update");

  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: targetId }, data: userData });
    }
    for (const [field, value] of profilePairs) {
      // Allowlisted identifiers only — never sourced from the model directly.
      await tx.$executeRawUnsafe(
        `UPDATE hr_employee_profiles SET ${field} = $1, updated_at = now() WHERE user_id = $2`,
        value, targetId,
      );
    }
    // IC edits refresh DOB/gender derivation when those are empty.
    if (str(p.ic_number)) {
      const { dob, gender } = icDerive(str(p.ic_number));
      if (dob) {
        await tx.$executeRaw`
          UPDATE hr_employee_profiles
          SET date_of_birth = COALESCE(date_of_birth, ${dob}::date),
              gender = CASE WHEN coalesce(gender,'') = '' THEN ${gender} ELSE gender END
          WHERE user_id = ${targetId}
        `;
      }
    }
  });
  const fields = [...Object.keys(userData).filter((f) => f !== "pin"), ...profilePairs.map(([f]) => f), ...(str(p.pin) ? ["PIN"] : [])];
  return `✅ updated ${fields.join(", ")}`;
}

async function execConvertEmployment(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  const to = str(p.to) === "full_time" ? "full_time" : "part_time";
  const effective = isoOrToday(p.effectiveDate);
  const hourlyRate = num(p.hourlyRate);
  const basicSalary = num(p.basicSalary);
  if (!targetId) throw new Error("targetId required");
  if (to === "part_time" && hourlyRate === null) throw new Error("part_time conversion needs hourlyRate");
  if (to === "full_time" && basicSalary === null) throw new Error("full_time conversion needs basicSalary");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE hr_employee_profiles
      SET employment_type = ${to},
          basic_salary = ${to === "full_time" ? basicSalary : 0},
          hourly_rate = ${to === "part_time" ? hourlyRate : null},
          attendance_allowance_amount = ${to === "part_time" ? null : num(p.attendanceAllowance)},
          performance_allowance_amount = ${to === "part_time" ? null : num(p.performanceAllowance)},
          notes = trim(both E'\n' from coalesce(notes,'') || E'\n' || ${`[Converted to ${to} effective ${effective} via HR agent]`}),
          updated_at = now()
      WHERE user_id = ${targetId}
    `;
    await tx.$executeRaw`
      UPDATE hr_job_history SET end_date = ${effective}::date - 1
      WHERE user_id = ${targetId} AND end_date IS NULL
    `;
    await tx.$executeRaw`
      UPDATE hr_salary_history SET end_date = ${effective}::date - 1
      WHERE user_id = ${targetId} AND end_date IS NULL
    `;
    await tx.$executeRaw`
      INSERT INTO hr_job_history (user_id, effective_date, job_title, outlet_id, employment_type, note, created_at)
      SELECT ${targetId}, ${effective}::date, coalesce(p.position,'Staff'), u."outletId", ${to}, 'Employment conversion (HR agent)', now()
      FROM "User" u LEFT JOIN hr_employee_profiles p ON p.user_id = u.id WHERE u.id = ${targetId}
    `;
    await tx.$executeRaw`
      INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
      VALUES (${targetId}, ${effective}::date, ${to === "part_time" ? "hourly" : "monthly"},
              ${to === "part_time" ? hourlyRate : basicSalary}, 'Employment conversion (HR agent)', now())
    `;
  });
  return `✅ converted to ${to} (${to === "part_time" ? `RM${hourlyRate}/hr` : `RM${basicSalary}/mo`}) effective ${effective}`;
}

async function execReactivate(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  if (!targetId) throw new Error("targetId required");
  const effective = isoOrToday(p.effectiveDate);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetId }, data: { status: "ACTIVE" } });
    await tx.$executeRaw`
      UPDATE hr_employee_profiles
      SET resigned_at = NULL, end_date = NULL,
          notes = trim(both E'\n' from coalesce(notes,'') || E'\n' || ${`[Reactivated ${effective} via HR agent]`}),
          updated_at = now()
      WHERE user_id = ${targetId}
    `;
    await tx.$executeRaw`
      INSERT INTO hr_job_history (user_id, effective_date, job_title, outlet_id, employment_type, note, created_at)
      SELECT ${targetId}, ${effective}::date, coalesce(p.position,'Staff'), u."outletId", coalesce(p.employment_type,'part_time'), 'Rehire/reactivation (HR agent)', now()
      FROM "User" u LEFT JOIN hr_employee_profiles p ON p.user_id = u.id WHERE u.id = ${targetId}
    `;
  });
  return `✅ reactivated effective ${effective} — existing PIN/app access still work`;
}

async function execResign(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  if (!targetId) throw new Error("targetId required");
  const resignedAt = isoOrToday(p.resignedAt);
  const endDate = str(p.endDate) || resignedAt;
  if (!ISO_DATE.test(endDate)) throw new Error("endDate must be YYYY-MM-DD");
  if (endDate < resignedAt) throw new Error("endDate before resignedAt");

  const assets = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM hr_company_assets WHERE user_id = ${targetId} AND status = 'issued'
  `;
  const outstanding = Number(assets[0]?.n ?? 0);

  const today = mytToday();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE hr_employee_profiles
      SET resigned_at = ${resignedAt}::date, end_date = ${endDate}::date,
          notes = trim(both E'\n' from coalesce(notes,'') || E'\n' || ${`[Resigned ${endDate}${str(p.reason) ? ` — ${str(p.reason)}` : ""} (HR agent)]`}),
          updated_at = now()
      WHERE user_id = ${targetId}
    `;
    await tx.$executeRaw`
      UPDATE hr_job_history SET end_date = ${endDate}::date
      WHERE user_id = ${targetId} AND end_date IS NULL
    `;
    if (endDate <= today) {
      await tx.user.update({ where: { id: targetId }, data: { status: "DEACTIVATED" } });
    }
  });
  return `✅ resignation recorded — last day ${endDate}${endDate <= today ? ", account deactivated" : ""}${outstanding ? ` ⚠️ ${outstanding} company asset(s) still issued — chase return` : ""}`;
}

async function execAssignment(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  if (!targetId) throw new Error("targetId required");
  const changes: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (str(p.outletName)) {
      const outlet = await resolveOutlet(str(p.outletName));
      if (!outlet) throw new Error(`no outlet matching "${str(p.outletName)}"`);
      await tx.user.update({ where: { id: targetId }, data: { outletId: outlet.id } });
      changes.push(`outlet → ${outlet.name}`);
    }
    if (str(p.position)) {
      const position = str(p.position);
      await tx.$executeRaw`
        UPDATE hr_employee_profiles SET position = ${position}, stations = ${stationsFor(position)}::text[], updated_at = now()
        WHERE user_id = ${targetId}
      `;
      changes.push(`position → ${position}`);
    }
    if (Array.isArray(p.stations) && p.stations.length) {
      const stations = (p.stations as unknown[]).map(String).filter((s) => ["foh", "boh", "lead"].includes(s));
      if (stations.length) {
        await tx.$executeRaw`
          UPDATE hr_employee_profiles SET stations = ${stations}::text[], updated_at = now() WHERE user_id = ${targetId}
        `;
        changes.push(`stations → ${stations.join("+")}`);
      }
    }
    if (str(p.managerUserId)) {
      await tx.$executeRaw`
        UPDATE hr_employee_profiles SET manager_user_id = ${str(p.managerUserId)}, updated_at = now() WHERE user_id = ${targetId}
      `;
      changes.push("manager updated");
    }
  });
  if (!changes.length) throw new Error("nothing to change");
  return `✅ ${changes.join(", ")}`;
}

async function execSetPin(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  const pin = str(p.pin);
  if (!targetId) throw new Error("targetId required");
  if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4-6 digits");
  await prisma.user.update({ where: { id: targetId }, data: { pin: await hashPin(pin) } });
  return "✅ PIN updated (stored hashed)";
}

async function execSalaryChange(p: Record<string, unknown>): Promise<string> {
  const targetId = str(p.targetId);
  if (!targetId) throw new Error("targetId required");
  const effective = isoOrToday(p.effectiveDate);
  const hourlyRate = num(p.hourlyRate);
  const basicSalary = num(p.basicSalary);
  if (hourlyRate === null && basicSalary === null) throw new Error("need hourlyRate or basicSalary");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE hr_employee_profiles
      SET basic_salary = COALESCE(${basicSalary}, basic_salary),
          hourly_rate = COALESCE(${hourlyRate}, hourly_rate),
          attendance_allowance_amount = COALESCE(${num(p.attendanceAllowance)}, attendance_allowance_amount),
          performance_allowance_amount = COALESCE(${num(p.performanceAllowance)}, performance_allowance_amount),
          updated_at = now()
      WHERE user_id = ${targetId}
    `;
    await tx.$executeRaw`
      UPDATE hr_salary_history SET end_date = ${effective}::date - 1
      WHERE user_id = ${targetId} AND end_date IS NULL
    `;
    await tx.$executeRaw`
      INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
      VALUES (${targetId}, ${effective}::date,
              ${hourlyRate !== null ? "hourly" : "monthly"}, ${hourlyRate ?? basicSalary},
              'Salary change (HR agent, owner-confirmed)', now())
    `;
  });
  return `✅ pay updated (${hourlyRate !== null ? `RM${hourlyRate}/hr` : `RM${basicSalary}/mo`}) effective ${effective}`;
}

// ── Staff-persona direct writes (no confirm code; inherently double-gated) ──

export async function staffSubmitLeave(
  userId: string,
  p: { leaveType: string; startDate: string; endDate: string; reason?: string },
): Promise<string> {
  if (!ISO_DATE.test(p.startDate) || !ISO_DATE.test(p.endDate)) throw new Error("dates must be YYYY-MM-DD");
  if (p.endDate < p.startDate) throw new Error("end date before start date");
  const type = ["annual", "sick", "emergency", "unpaid"].includes(p.leaveType) ? p.leaveType : "annual";
  // Sick leave needs an MC attached and WhatsApp text can't carry one — the
  // staff app enforces the MC at submit and the review card is where it gets
  // read. Letting this path insert sick leave bypassed that rule entirely.
  if (type === "sick") {
    throw new Error("sick leave needs a medical certificate — submit it in the staff app so the MC photo can be attached");
  }
  const totalDays =
    Math.floor((Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (totalDays < 1 || totalDays > 60) throw new Error("invalid range");

  // Balance is keyed to the leave's START year — the approve path banks
  // used_days against that year, so the hold must land on the same row.
  const balanceYear = Number(p.startDate.slice(0, 4));
  const bal = await prisma.$queryRaw<Array<{ id: string; remaining: number }>>`
    SELECT id, (entitled_days + carried_forward - used_days - pending_days)::float AS remaining
    FROM hr_leave_balances
    WHERE user_id = ${userId} AND leave_type = ${type} AND year = ${balanceYear}
  `;
  const remaining = bal[0]?.remaining;

  await prisma.$executeRaw`
    INSERT INTO hr_leave_requests (user_id, leave_type, start_date, end_date, total_days, reason, status)
    VALUES (${userId}, ${type}, ${p.startDate}::date, ${p.endDate}::date, ${totalDays}, ${p.reason ?? null}, 'pending')
  `;
  // Reserve the days. Every other submit path (staff app, AI leave-manager)
  // holds pending_days on insert, and the approve/reject paths RELEASE that
  // hold unconditionally (clamped at 0) — so an unreserved request ate the
  // reservation of whichever OTHER pending request the person had. Three such
  // drift rows existed in prod when this was found.
  if (bal[0]?.id) {
    await prisma.$executeRaw`
      UPDATE hr_leave_balances SET pending_days = pending_days + ${totalDays}
      WHERE id = ${bal[0].id}::uuid
    `;
  }
  const balNote =
    remaining === undefined ? "" : remaining < totalDays ? ` NOTE: only ${remaining} day(s) remaining — manager may reject.` : ` (${remaining} day(s) remaining before this)`;
  return `submitted ${totalDays}-day ${type} leave ${p.startDate}→${p.endDate}, pending manager approval.${balNote}`;
}

export async function staffUpdateOwnContact(
  userId: string,
  p: { emergencyName?: string; emergencyPhone?: string; personalEmail?: string; addressLine1?: string; addressCity?: string; addressState?: string; addressPostcode?: string },
): Promise<string> {
  const pairs: Array<[string, string]> = [];
  if (str(p.emergencyName)) pairs.push(["emergency_contact_name", str(p.emergencyName)]);
  if (str(p.emergencyPhone)) pairs.push(["emergency_contact_phone", str(p.emergencyPhone)]);
  if (str(p.personalEmail)) pairs.push(["personal_email", str(p.personalEmail)]);
  if (str(p.addressLine1)) pairs.push(["address_line1", str(p.addressLine1)]);
  if (str(p.addressCity)) pairs.push(["address_city", str(p.addressCity)]);
  if (str(p.addressState)) pairs.push(["address_state", str(p.addressState)]);
  if (str(p.addressPostcode)) pairs.push(["address_postcode", str(p.addressPostcode)]);
  if (!pairs.length) throw new Error("nothing to update");
  for (const [field, value] of pairs) {
    // Field names come from the allowlist above, never from the model.
    await prisma.$executeRawUnsafe(
      `UPDATE hr_employee_profiles SET ${field} = $1, updated_at = now() WHERE user_id = $2`,
      value, userId,
    );
  }
  return `updated: ${pairs.map(([f]) => f.replace(/_/g, " ")).join(", ")}`;
}
