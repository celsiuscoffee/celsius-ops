// HR ops tools — the OPS persona of the HR Ops Agent, exposed through the
// existing internal WhatsApp assistant (owner/HOO/manager senders).
// Design: docs/design/hr-ops-agent.md §3 (authority matrix), §"Write guardrails".
//
// Stage 2: stage_hr_change stages a TYPED operation (write-ops allowlist) with
// a single-use confirm code; execution happens only in the deterministic
// confirm hook (pending.ts) when the DESIGNATED approver's phone replies
// CONFIRM <code>. In shadow mode staging degrades to proposal-only logging.
//
// Authority in code, not prompt:
//   - find_staff: managers see only their reporting subtree
//     (resolveVisibleUserIds) and NEVER pay/bank/statutory fields.
//   - stage_hr_change: authorize() enforces the matrix — plain managers'
//     changes confirm with the HOO; salary/bank changes confirm with the
//     OWNER; subtree rule on targets; rate limits.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import type { AssistantReporter, ToolSpec } from "@/lib/ops-intake/assistant";
import {
  type ActionType,
  type Requester,
  isHOOUser,
  resolveStaffTarget,
  OUTLET_ALIASES,
} from "./write-ops";
import { stageAction } from "./pending";

export { OUTLET_ALIASES };

const ACTION_TYPES: ActionType[] = [
  "create_staff", "update_details", "convert_employment", "reactivate",
  "resign", "assignment", "set_pin", "salary_change",
];

const like = (q: string) => `%${q.trim()}%`;

async function findStaff(reporter: AssistantReporter, query: string) {
  const q = (query ?? "").trim();
  if (q.length < 2) return { error: "query too short" };
  const canSeePII = reporter.role !== "MANAGER";
  const visible = await resolveVisibleUserIds({ role: reporter.role, id: reporter.id });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string; name: string; full_name: string | null; status: string;
      outlet: string | null; phone: string | null; position: string | null;
      employment_type: string | null; join_date: string | null; resigned_at: string | null;
      stations: string[] | null; manager: string | null; has_pin: boolean;
      ic_number: string | null; epf_number: string | null; bank_name: string | null;
      has_bank: boolean; hourly_rate: number | null; basic_salary: number | null;
    }>
  >`
    SELECT u.id, u.name, u."fullName" AS full_name, u.status::text, o.name AS outlet, u.phone,
           p.position, p.employment_type, p.join_date::text, p.resigned_at::text, p.stations,
           mgr.name AS manager, (u.pin IS NOT NULL) AS has_pin,
           p.ic_number, p.epf_number, u."bankName" AS bank_name,
           (u."bankAccountNumber" IS NOT NULL AND u."bankAccountNumber" <> '') AS has_bank,
           p.hourly_rate::float, p.basic_salary::float
    FROM "User" u
    LEFT JOIN hr_employee_profiles p ON p.user_id = u.id
    LEFT JOIN "Outlet" o ON o.id = u."outletId"
    LEFT JOIN "User" mgr ON mgr.id = p.manager_user_id
    WHERE u.name ILIKE ${like(q)} OR coalesce(u."fullName", '') ILIKE ${like(q)}
       OR coalesce(u.phone, '') ILIKE ${like(q)} OR coalesce(u.email, '') ILIKE ${like(q)}
       OR coalesce(p.ic_number, '') ILIKE ${like(q)}
    ORDER BY (u.status = 'ACTIVE') DESC, u.name
    LIMIT 8
  `;

  const scoped = visible === null ? rows : rows.filter((r) => visible.includes(r.id));
  return {
    matches: scoped.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      status: r.status,
      outlet: r.outlet,
      position: r.position,
      employmentType: r.employment_type,
      joinDate: r.join_date,
      resignedAt: r.resigned_at,
      stations: r.stations ?? [],
      manager: r.manager,
      canLogin: r.has_pin,
      // Payroll PII: OWNER/ADMIN only — a manager's WhatsApp must not become
      // the leak path around the backoffice PII gate (design §3).
      ...(canSeePII
        ? {
            icLast4: r.ic_number ? r.ic_number.replace(/[^0-9]/g, "").slice(-4) : null,
            epfOnFile: !!r.epf_number,
            bank: r.bank_name,
            bankOnFile: r.has_bank,
            hourlyRate: r.hourly_rate,
            basicSalary: r.basic_salary,
          }
        : {}),
    })),
    hiddenByScope: visible === null ? 0 : rows.length - scoped.length,
    note: canSeePII ? undefined : "pay/bank/IC fields hidden for manager role",
  };
}

async function hrDataGaps(reporter: AssistantReporter) {
  const visible = await resolveVisibleUserIds({ role: reporter.role, id: reporter.id });
  const scope = visible === null ? Prisma.empty : Prisma.sql`AND u.id IN (${Prisma.join(visible.length ? visible : ["__none__"])})`;
  const rows = await prisma.$queryRaw<
    Array<{ name: string; outlet: string | null; missing: string[] }>
  >`
    SELECT u.name, o.name AS outlet,
           array_remove(ARRAY[
             CASE WHEN u."bankAccountNumber" IS NULL OR u."bankAccountNumber" = '' THEN 'bank' END,
             CASE WHEN (p.epf_number IS NULL OR p.epf_number = '') AND p.employment_type = 'full_time' THEN 'epf' END,
             CASE WHEN p.ic_number IS NULL OR p.ic_number = '' THEN 'ic' END,
             CASE WHEN p.emergency_contact_name IS NULL OR p.emergency_contact_name = '' THEN 'emergency_contact' END,
             CASE WHEN u.pin IS NULL THEN 'login_pin' END
           ], NULL) AS missing
    FROM "User" u
    JOIN hr_employee_profiles p ON p.user_id = u.id
    LEFT JOIN "Outlet" o ON o.id = u."outletId"
    WHERE u.status = 'ACTIVE' AND u.role = 'STAFF' ${scope}
    ORDER BY o.name NULLS FIRST, u.name
  `;
  const withGaps = rows.filter((r) => (r.missing ?? []).length > 0);
  return {
    staffChecked: rows.length,
    complete: rows.length - withGaps.length,
    gaps: withGaps.map((r) => ({ name: r.name, outlet: r.outlet, missing: r.missing })),
    reference: "full audit: docs/hr-data-audit-2026-07-26.md",
  };
}

interface StageInput {
  action?: string;
  target?: { name?: string; ic?: string; phone?: string };
  fields?: Record<string, unknown>;
}

function buildCard(action: ActionType, targetLabel: string | null, fields: Record<string, unknown>, requester: string): string {
  const lines = [
    `HR change: ${action.replace(/_/g, " ")}`,
    targetLabel ? `Staff: ${targetLabel}` : null,
    ...Object.entries(fields)
      .filter(([k, v]) => v !== undefined && v !== null && v !== "" && k !== "pin")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("+") : String(v)}`),
    ...(fields.pin ? ["pin: (provided, will be stored hashed)"] : []),
    `Requested by: ${requester}`,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

async function stageHrChange(reporter: AssistantReporter, input: StageInput) {
  const action = (input.action ?? "") as ActionType;
  if (!ACTION_TYPES.includes(action)) {
    return { error: `action must be one of: ${ACTION_TYPES.join(", ")}` };
  }
  const fields = input.fields ?? {};
  const requester: Requester = {
    id: reporter.id,
    name: reporter.name,
    role: reporter.role,
    isHOO: await isHOOUser(reporter.id),
  };

  // Resolve the target person for everything except a brand-new hire.
  let targetId: string | null = null;
  let targetLabel: string | null = null;
  let target = null;
  if (action !== "create_staff") {
    const res = await resolveStaffTarget(input.target ?? {}, {
      includeDeactivated: action === "reactivate",
    });
    if (res.error || !res.target) {
      return { error: res.error, candidates: res.candidates };
    }
    target = res.target;
    targetId = res.target.id;
    targetLabel = `${res.target.name}${res.target.fullName ? ` (${res.target.fullName})` : ""} — ${res.target.outletName ?? "no outlet"}, ${res.target.status}`;
  }

  const payload = { ...fields, ...(targetId ? { targetId } : {}) };
  const card = buildCard(action, targetLabel, fields, `${reporter.name} (${reporter.role}${requester.isHOO ? "/HOO" : ""})`);
  const result = await stageAction({ action, payload, card, requester, target });
  return { card, ...result };
}

// Factory: the internal assistant concatenates these per call, so `reporter`
// rides the closure and the existing ToolSpec run signature stays unchanged.
export function buildHrOpsTools(reporter: AssistantReporter): ToolSpec[] {
  return [
    {
      def: {
        name: "find_staff",
        description:
          "Look up staff/employee records by name, phone, email, or IC — employment status, outlet, position, manager, login readiness; ALWAYS use before staging any staff change (dedup: the person may already exist or be deactivated). Informal branch names: 'Cyberjaya' means the Tamarind outlet.",
        input_schema: {
          type: "object" as const,
          properties: { query: { type: "string", description: "Name / phone / email / IC fragment" } },
          required: ["query"],
        },
      },
      run: (a) => findStaff(reporter, String(a.query ?? "")),
    },
    {
      def: {
        name: "hr_data_gaps",
        description:
          "Which active staff are missing critical HR data (bank details, EPF, IC, emergency contact, login PIN) — the onboarding-completeness chase list.",
        input_schema: { type: "object" as const, properties: {} },
      },
      run: () => hrDataGaps(reporter),
    },
    {
      def: {
        name: "stage_hr_change",
        description:
          "Stage an HR change for execution. NOTHING is applied by this tool — it returns a record card and a single-use confirm code; the change executes only when the designated approver replies 'CONFIRM <code>' on WhatsApp (plain managers' changes go to the HOO; salary or bank changes go to the owner). Use find_staff first. Actions and their fields: " +
          "create_staff {name, fullName?, phone?, email?, outletName, position, employmentType: full_time|part_time, hourlyRate? (PT), basicSalary? (FT), performanceAllowance?, attendanceAllowance?, epf?, ic?, bankName?, bankAccountNumber?, bankAccountName?, joinDate? YYYY-MM-DD, pin?, notes?} · " +
          "update_details {email?, phone?, epf_number?, ic_number?, bankName?, bankAccountNumber?, bankAccountName?, emergency_contact_name?, emergency_contact_phone?, personal_email?, pin?} · " +
          "convert_employment {to: full_time|part_time, hourlyRate?|basicSalary?, effectiveDate?} · " +
          "reactivate {effectiveDate?} · resign {resignedAt?, endDate?, reason?} · " +
          "assignment {outletName?, position?, stations? [foh|boh|lead], managerUserId?} · " +
          "set_pin {pin (4-6 digits)} · salary_change {hourlyRate?|basicSalary?, attendanceAllowance?, performanceAllowance?, effectiveDate?}. " +
          "Restate EVERY detail the requester gave into fields; if pay/dates are missing or FT-vs-PT is ambiguous, ask ONE crisp question first instead of guessing.",
        input_schema: {
          type: "object" as const,
          properties: {
            action: { type: "string", enum: ACTION_TYPES as unknown as string[] },
            target: {
              type: "object",
              description: "Who the change is about (omit for create_staff). Give the most specific identifier available.",
              properties: {
                name: { type: "string" },
                ic: { type: "string" },
                phone: { type: "string" },
              },
            },
            fields: { type: "object", description: "Action-specific fields, see tool description" },
          },
          required: ["action", "fields"],
        },
      },
      run: (a) => stageHrChange(reporter, a as StageInput),
    },
  ];
}
