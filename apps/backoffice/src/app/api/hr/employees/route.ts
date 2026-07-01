import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { signAttendancePhotos } from "@/lib/hr/photos";

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
      outletId: true, outlet: { select: { name: true } },
      username: true, appAccess: true, moduleAccess: true, status: true,
      pin: true, passwordHash: true, lastLoginAt: true,
      ...(canSeePayrollPII ? { bankName: true, bankAccountNumber: true, bankAccountName: true } : {}),
    },
    orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
  });

  const PII_PROFILE_FIELDS = [
    // Compensation + banking
    "basic_salary", "hourly_rate",
    "attendance_allowance_amount", "performance_allowance_amount",
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

  // Upsert: check if profile exists
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();

  if (existing) {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ ...profileData, updated_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  } else {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .insert({ user_id, ...profileData })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  }
}
