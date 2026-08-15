import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { signAttendancePhotos } from "@/lib/hr/photos";
import { logActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

// GET: list employees with their HR profiles
// - OWNER / ADMIN: all active users
// - MANAGER: only their direct reports (users whose hr_employee_profiles.manager_user_id = session.id)
// - other roles: unauthorized
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all HR profiles from Supabase (need these for manager filter + enrichment)
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*");
  const profileMap = new Map((profiles || []).map((p: { user_id: string }) => [p.user_id, p]));

  // Determine visible user-id set for non-admin managers.
  // Managers see EVERYONE in their subtree — direct reports AND reports-of-reports —
  // walked transitively via manager_user_id. Shared helper in lib/hr/scope.ts.
  const visibleIds = await resolveVisibleUserIds(session);

  // Payroll PII (bank, salary, statutory IDs) is restricted to OWNER/ADMIN only.
  // MANAGER sees minimal profile — personnel info, not compensation/banking.
  const canSeePayrollPII = ["OWNER", "ADMIN"].includes(session.role);

  // Include DEACTIVATED users too — the client can filter for the Resigned tab.
  // Keeps ACTIVE users first in the result (alphabetical within role).
  const users = await prisma.user.findMany({
    where: {
      status: { in: ["ACTIVE", "DEACTIVATED"] },
      ...(visibleIds !== null ? { id: { in: visibleIds } } : {}),
    },
    select: {
      id: true, name: true, fullName: true, role: true, phone: true, email: true,
      outletId: true, outletIds: true, outlet: { select: { name: true } },
      username: true, appAccess: true, moduleAccess: true, status: true,
      pin: true, passwordHash: true, lastLoginAt: true,
      ...(canSeePayrollPII ? { bankName: true, bankAccountNumber: true, bankAccountName: true } : {}),
    },
    orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
  });

  const PII_PROFILE_FIELDS = [
    // Compensation + banking
    "basic_salary", "hourly_rate", "hourly_rate_weekend",
    "performance_allowance_amount",
    "overtime_flat_rate", "shift_flat_rate",
    // Statutory / government identifiers
    "ic_number", "passport_number", "passport_expiry",
    "epf_number", "socso_number", "eis_number", "tax_number", "pcb_number", "ssfw_number",
    "epf_employee_rate", "epf_employer_rate", "epf_category",
    // PDPA-sensitive personal data — a line manager has no operational need for
    // these and BrioHR gates them to HR admins. Emergency contact is kept
    // (managers may need it on-shift).
    "date_of_birth", "race", "religion", "marital_status",
    "address_line1", "address_line2", "address_city", "address_state", "address_postcode",
    "spouse_name", "spouse_working", "num_children", "children_count",
    "personal_email", "secondary_phone",
    "spouse_relief", "lifestyle_relief", "life_insurance_relief", "medical_relief", "education_relief",
    "zakat_amount", "zakat_enabled", "prs_rate",
  ];

  const sanitizeProfile = (profile: Record<string, unknown> | undefined) => {
    if (!profile) return null;
    if (canSeePayrollPII) return profile;
    const copy = { ...profile };
    for (const k of PII_PROFILE_FIELDS) delete copy[k];
    return copy;
  };

  // Profile photos: derive from each employee's earliest clock-in selfie. We
  // already capture (and timestamp-overlay) selfies in hr_attendance_logs,
  // so use the very first one as a free profile photo. Single batched query —
  // grouped client-side so the list endpoint stays at one round trip.
  const userIds = users.map((u) => u.id);
  const { data: photoLogs } = userIds.length > 0
    ? await hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("user_id, clock_in, clock_in_photo_url")
        .in("user_id", userIds)
        .not("clock_in_photo_url", "is", null)
        .order("clock_in", { ascending: true })
    : { data: [] as Array<{ user_id: string; clock_in: string; clock_in_photo_url: string | null }> };
  const firstPhotoByUser = new Map<string, string>();
  for (const row of photoLogs || []) {
    if (row.clock_in_photo_url && !firstPhotoByUser.has(row.user_id)) {
      firstPhotoByUser.set(row.user_id, row.clock_in_photo_url);
    }
  }
  // Private bucket → sign the stored path so the avatar renders (30-min URL).
  const signedPhotos = await signAttendancePhotos(Array.from(firstPhotoByUser.values()));
  for (const [uid, stored] of firstPhotoByUser) {
    const signed = signedPhotos.get(stored);
    if (signed) firstPhotoByUser.set(uid, signed);
    else firstPhotoByUser.delete(uid);
  }

  // Onboarding progress per user: count of completed tasks vs applicable
  // tasks (filtered by employment_type). Surfaces a small dot/progress bar
  // on the employees list so HR can see who's still being onboarded.
  const [tplRes, progRes] = await Promise.all([
    hrSupabaseAdmin
      .from("hr_onboarding_templates")
      .select("id, applies_to_employment_types")
      .eq("is_active", true),
    userIds.length > 0
      ? hrSupabaseAdmin
          .from("hr_onboarding_progress")
          .select("user_id, template_id, completed_at")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; template_id: string; completed_at: string | null }> }),
  ]);
  type Tpl = { id: string; applies_to_employment_types: string[] | null };
  const allTemplates = (tplRes.data || []) as Tpl[];
  const completedByUser = new Map<string, Set<string>>();
  for (const p of (progRes.data || []) as Array<{ user_id: string; template_id: string; completed_at: string | null }>) {
    if (!p.completed_at) continue;
    const set = completedByUser.get(p.user_id) || new Set<string>();
    set.add(p.template_id);
    completedByUser.set(p.user_id, set);
  }

  const employees = users.map((u) => {
    const { pin, passwordHash, ...rest } = u;
    const profile = profileMap.get(u.id) as { employment_type?: string } | undefined;
    const empType = profile?.employment_type || "full_time";
    const applicableTemplates = allTemplates.filter(
      (t) => !t.applies_to_employment_types || t.applies_to_employment_types.length === 0 || t.applies_to_employment_types.includes(empType),
    );
    const completed = completedByUser.get(u.id) || new Set<string>();
    const onboardingTotal = applicableTemplates.length;
    const onboardingDone = applicableTemplates.filter((t) => completed.has(t.id)).length;
    return {
      ...rest,
      hasPin: !!pin,
      hasPassword: !!passwordHash,
      // First clock-in photo = profile photo. Stays null for new hires until
      // they clock in for the first time, in which case the page falls back
      // to the initial-letter avatar.
      profile_photo_url: firstPhotoByUser.get(u.id) || null,
      onboarding: {
        done: onboardingDone,
        total: onboardingTotal,
      },
      hrProfile: sanitizeProfile(profileMap.get(u.id) as Record<string, unknown> | undefined),
    };
  });

  return NextResponse.json({ employees, scope: session.role === "MANAGER" ? "direct-reports" : "all" });
}

// Lifecycle fields owned by dedicated flows — never writable through the
// generic profile upsert. resign/undo-resign owns resigned_at + end_date, the
// probation-review approval owns confirmed_at. Letting the blind upsert write
// them meant every invariant those flows enforce (guards, audit, history
// closure) had an unaudited side door.
const FLOW_OWNED_FIELDS = ["confirmed_at", "resigned_at", "end_date", "id", "created_at", "updated_at"] as const;

// profile column ↔ salary_history.salary_type, for the supersede writes below.
const PAY_COLUMNS: Array<{ column: "basic_salary" | "hourly_rate" | "hourly_rate_weekend"; salaryType: string }> = [
  { column: "basic_salary", salaryType: "monthly" },
  { column: "hourly_rate", salaryType: "hourly" },
  { column: "hourly_rate_weekend", salaryType: "hourly_weekend" },
];

// POST: create or update an HR profile for an employee
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, ...profileData } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const ignoredFields: string[] = [];
  for (const f of FLOW_OWNED_FIELDS) {
    if (f in profileData) {
      delete profileData[f];
      ignoredFields.push(f);
    }
  }

  // Upsert: check if profile exists. The pay/type columns are read too so pay
  // edits and employment-type flips through this form keep hr_salary_history
  // in step — this route used to write them blind, which (a) left history
  // disagreeing with what payroll actually pays, and (b) on an FT→PT flip
  // never closed the open monthly row, so the FT-stint recovery (the
  // Zarif/Danish fix) had nothing to find and the salaried part of the month
  // silently unpaid.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("id, employment_type, basic_salary, hourly_rate, hourly_rate_weekend")
    .eq("user_id", user_id)
    .maybeSingle();

  const todayMyt = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const historyNotes: string[] = [];

  if (existing) {
    const oldType = existing.employment_type as string | null;
    const newType = (profileData.employment_type as string | undefined) ?? undefined;
    const typeChanged = newType !== undefined && newType !== oldType;

    if (typeChanged) {
      // Mirror the HR agent's conversion transaction shape (write-ops
      // execConvertEmployment): close the outgoing type's open history
      // segment at yesterday, open the incoming type's segment today. The
      // form has no effective-date field, so a form-driven conversion is
      // "effective today" by definition — anything backdated should go
      // through the agent, which takes an explicit date.
      const wasMonthly = oldType === "full_time";
      const isMonthly = newType === "full_time";
      await prisma.$transaction(async (tx) => {
        if (wasMonthly && !isMonthly) {
          await tx.$executeRaw`
            UPDATE hr_salary_history SET end_date = ${todayMyt}::date - 1
            WHERE user_id = ${user_id} AND salary_type = 'monthly' AND end_date IS NULL
          `;
          const hourly = Number(profileData.hourly_rate ?? existing.hourly_rate ?? 0);
          if (hourly > 0) {
            await tx.$executeRaw`
              INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
              VALUES (${user_id}, ${todayMyt}::date, 'hourly', ${hourly},
                      ${"Employment converted to " + newType + " via employee profile form"}, now())
            `;
          }
          historyNotes.push(`closed monthly salary segment (FT stint ends ${todayMyt})`);
        } else if (!wasMonthly && isMonthly) {
          await tx.$executeRaw`
            UPDATE hr_salary_history SET end_date = ${todayMyt}::date - 1
            WHERE user_id = ${user_id} AND salary_type IN ('hourly', 'hourly_weekend') AND end_date IS NULL
          `;
          const monthly = Number(profileData.basic_salary ?? existing.basic_salary ?? 0);
          if (monthly > 0) {
            await tx.$executeRaw`
              INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
              VALUES (${user_id}, ${todayMyt}::date, 'monthly', ${monthly},
                      'Employment converted to full_time via employee profile form', now())
            `;
          }
          historyNotes.push("closed hourly salary segments, opened monthly");
        }
        // Conversions between non-FT types (part_time ↔ contract/intern) keep
        // hourly rows open — same rate basis, nothing to close.
      });
    }

    // Pay edits WITHOUT a type change: supersede the matching history segment
    // so "current rate" in salary history always equals what payroll pays.
    if (!typeChanged) {
      for (const { column, salaryType } of PAY_COLUMNS) {
        if (!(column in profileData)) continue;
        const next = profileData[column] == null ? null : Number(profileData[column]);
        const cur = existing[column] == null ? null : Number(existing[column]);
        if (next == null || !Number.isFinite(next) || next <= 0 || next === cur) continue;
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE hr_salary_history SET end_date = ${todayMyt}::date - 1
            WHERE user_id = ${user_id} AND salary_type = ${salaryType} AND end_date IS NULL
          `;
          await tx.$executeRaw`
            INSERT INTO hr_salary_history (user_id, effective_date, salary_type, amount, comment, created_at)
            VALUES (${user_id}, ${todayMyt}::date, ${salaryType}, ${next},
                    'Edited via employee profile form', now())
          `;
        });
        historyNotes.push(`${salaryType} rate superseded: RM${cur ?? "unset"} → RM${next}`);
      }
    }

    if (typeChanged || historyNotes.length > 0) {
      await logActivity({
        actorId: session.id,
        action: typeChanged ? "employee.convert_employment" : "employee.pay_change",
        module: "hr",
        targetId: user_id,
        targetName: null,
        details: {
          ...(typeChanged ? { from: oldType, to: newType } : {}),
          history: historyNotes,
          source: "profile_form",
        },
        request: req,
      });
    }

    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ ...profileData, updated_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data, ignored_fields: ignoredFields, history_notes: historyNotes });
  } else {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .insert({ user_id, ...profileData })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data, ignored_fields: ignoredFields });
  }
}
