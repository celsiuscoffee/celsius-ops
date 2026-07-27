// HR ops tools — the OPS persona of the HR Ops Agent, exposed through the
// existing internal WhatsApp assistant (owner/admin/manager senders).
// Design: docs/design/hr-ops-agent.md §3 (authority matrix), §4 (capabilities).
//
// Stage 1 is SHADOW: propose_hr_change validates and builds the record card,
// logs the structured proposal to the agent_actions ledger, and pings the
// owner — but writes NOTHING to HR tables. A human applies the change (today:
// via Claude Code / backoffice) and the applied result is diffed against the
// proposal to earn arming (design §7).
//
// Authority in code, not prompt:
//   - find_staff: managers see only their own reporting subtree
//     (resolveVisibleUserIds — the same walk the HR employees API uses) and
//     NEVER pay/bank/statutory fields (parity with the backoffice PII gate).
//   - hr_data_gaps / propose_hr_change: available to all internal senders;
//     proposals carry the requester so the applier enforces the matrix
//     (e.g. salary changes need the owner) before applying.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendOpsDigest } from "@/lib/ops-pulse/sender";
import { resolveOwner } from "@/lib/ops-pulse/router";
import { getAgentMode, logAgentAction } from "@celsius/agents/src/substrate";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import type { AssistantReporter, ToolSpec } from "@/lib/ops-intake/assistant";
import { HR_AGENT_KEY } from "./staff-assistant";

// Informal names used on hiring paperwork → real Outlet rows. Learned aliases
// go here until the hr_agent_knowledge table ships (design §6).
export const OUTLET_ALIASES: Record<string, string> = {
  cyberjaya: "Celsius Coffee Tamarind", // STATE.md 2026-07-16 — no Cyberjaya outlet exists
  ioi: "Celsius Coffee IOI Mall",
  "ioi mall": "Celsius Coffee IOI Mall",
  putrajaya: "Celsius Coffee Putrajaya",
  conezion: "Celsius Coffee Putrajaya",
  "shah alam": "Celsius Coffee Shah Alam",
  tamarind: "Celsius Coffee Tamarind",
  nilai: "Celsius Coffee Nilai",
};

const like = (q: string) => `%${q.trim()}%`;

async function findStaff(reporter: AssistantReporter, query: string) {
  const q = (query ?? "").trim();
  if (q.length < 2) return { error: "query too short" };
  const canSeePII = reporter.role !== "MANAGER";
  const visible = await resolveVisibleUserIds({ role: reporter.role, id: reporter.id });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      full_name: string | null;
      status: string;
      outlet: string | null;
      phone: string | null;
      position: string | null;
      employment_type: string | null;
      join_date: string | null;
      resigned_at: string | null;
      stations: string[] | null;
      manager: string | null;
      has_pin: boolean;
      ic_number: string | null;
      epf_number: string | null;
      bank_name: string | null;
      has_bank: boolean;
      hourly_rate: number | null;
      basic_salary: number | null;
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

interface ProposalInput {
  change_type?: string;
  staff_name?: string;
  details?: string;
}

async function proposeHrChange(reporter: AssistantReporter, input: ProposalInput) {
  const mode = await getAgentMode(HR_AGENT_KEY);
  if (mode === "off") {
    return {
      disabled: true,
      note: "The HR agent is not enabled yet (registry mode off) — tell the requester to send this to Ammar directly for now.",
    };
  }
  const changeType = String(input.change_type ?? "other").slice(0, 40);
  const staffName = String(input.staff_name ?? "").slice(0, 120);
  const details = String(input.details ?? "").slice(0, 1500);
  if (!details) return { error: "details required — restate the full request" };

  const card = [
    `HR change proposal (${changeType})`,
    staffName ? `Staff: ${staffName}` : null,
    `Requested by: ${reporter.name} (${reporter.role})`,
    `Details: ${details}`,
    `Status: PENDING HUMAN APPLY (agent is in shadow — nothing written yet)`,
  ]
    .filter(Boolean)
    .join("\n");

  await logAgentAction({
    agentKey: HR_AGENT_KEY,
    kind: "proposal",
    summary: `${changeType}${staffName ? ` — ${staffName}` : ""} (by ${reporter.name})`,
    meta: { changeType, staffName, details, requestedBy: reporter.name, requesterRole: reporter.role },
  });

  // Ping the owner unless the owner asked — they're the applier in shadow.
  if (reporter.role !== "OWNER") {
    const owner = await resolveOwner();
    if (owner?.phone) {
      await sendOpsDigest(owner.phone, "🧑‍🍳 HR change proposed", [
        `${reporter.name}: ${changeType}${staffName ? ` — ${staffName}` : ""}`,
        details.slice(0, 200),
      ]);
    }
  }
  return {
    logged: true,
    card,
    tellRequester:
      "Confirm the request is captured and HQ will apply it shortly. Do NOT claim the change is already made — it is a pending proposal.",
  };
}

// Factory: the internal assistant concatenates these per call, so `reporter`
// rides the closure and the existing ToolSpec run signature stays unchanged.
export function buildHrOpsTools(reporter: AssistantReporter): ToolSpec[] {
  return [
    {
      def: {
        name: "find_staff",
        description:
          "Look up staff/employee records by name, phone, email, or IC — employment status, outlet, position, manager, login readiness; ALWAYS use before proposing any staff change (dedup: the person may already exist or be deactivated). Informal branch names: 'Cyberjaya' means the Tamarind outlet.",
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
        name: "propose_hr_change",
        description:
          "File an HR change REQUEST as a structured proposal for HQ to apply: new hire, reactivate, FT↔PT conversion, outlet/position/manager change, resignation, PIN reset, bank/EPF detail updates. Use after find_staff. Nothing is written by this tool — it logs the proposal and notifies the owner. Restate ALL specifics the requester gave (names, IC, rates, dates, outlet) in details.",
        input_schema: {
          type: "object" as const,
          properties: {
            change_type: {
              type: "string",
              description: "hire | reactivate | convert_ft_pt | transfer | position_change | resignation | pin_reset | detail_update | other",
            },
            staff_name: { type: "string", description: "Who the change is about (as given)" },
            details: { type: "string", description: "Complete restatement of the request with every detail provided" },
          },
          required: ["change_type", "details"],
        },
      },
      run: (a) => proposeHrChange(reporter, a as ProposalInput),
    },
  ];
}
