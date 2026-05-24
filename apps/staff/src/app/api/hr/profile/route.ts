import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Use service-role: the staff app uses bearer-token auth, so there's no
// Supabase auth session and `auth.uid()` is null inside RLS policies —
// writes against the anon client get rejected with "permission denied".
// Permissions are still enforced here in code via `session.id` (every
// query filters on `user_id = session.id`).
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Fields the staff app is allowed to write to via this endpoint. Anything
// not in this list (salary, statutory numbers, manager, etc.) stays read-
// only from the staff side and is HR-managed only.
const SELF_EDITABLE_FIELDS = [
  "address_line1",
  "address_line2",
  "address_city",
  "address_state",
  "address_postcode",
  "marital_status",
  "spouse_name",
  "spouse_working",
  "num_children",
  "race",
  "religion",
  "personal_email",
  "secondary_phone",
  "education_level",
  "t_shirt_size",
  "dietary_restrictions",
  "emergency_contact_name",
  "emergency_contact_phone",
  "date_of_birth",
  "gender",
] as const;

type SelfEditableKey = (typeof SELF_EDITABLE_FIELDS)[number];

// Fields that count toward "profile complete" — only the ones we actually
// need for statutory/operational use. Optional metadata (t-shirt size,
// dietary) doesn't gate the banner.
const COMPLETENESS_FIELDS = [
  "address_line1",
  "address_city",
  "address_state",
  "address_postcode",
  "marital_status",
  "race",
  "religion",
  "personal_email",
  "emergency_contact_name",
  "emergency_contact_phone",
  "date_of_birth",
  "gender",
] as const;

// GET /api/hr/profile — staff reads their own profile. Returns the
// editable-by-staff slice plus a completeness gauge so the UI can render
// the progress bar without recomputing.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("hr_employee_profiles")
    .select("*")
    .eq("user_id", session.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profile = data || {};
  const filled = COMPLETENESS_FIELDS.filter((f) => {
    const v = (profile as Record<string, unknown>)[f];
    return v !== null && v !== undefined && v !== "";
  }).length;
  const total = COMPLETENESS_FIELDS.length;

  return NextResponse.json({
    profile,
    completeness: {
      filled,
      total,
      percent: Math.round((filled / total) * 100),
      complete: !!profile.profile_completed_at,
    },
  });
}

// PATCH /api/hr/profile — staff updates their own profile. Only the
// SELF_EDITABLE_FIELDS allowlist is honoured; anything else in the body
// is silently dropped. Save bumps profile_self_updated_at so HR can see
// who's actually maintaining their record.
//
// Body: { fields: Partial<Profile>, mark_complete?: boolean }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { fields?: Record<string, unknown>; mark_complete?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = body.fields ?? {};
  // Build the patch object from allowlist only. Coerce empty strings to
  // null so missing values don't show as the literal "" later.
  const patch: Record<string, unknown> = {};
  for (const key of SELF_EDITABLE_FIELDS) {
    if (key in incoming) {
      const v = incoming[key as SelfEditableKey];
      patch[key] = v === "" || v === undefined ? null : v;
    }
  }

  // Numeric coercion for num_children — staff app sends as string.
  if ("num_children" in patch && patch.num_children !== null) {
    const n = Number(patch.num_children);
    patch.num_children = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  if ("spouse_working" in patch && patch.spouse_working !== null) {
    patch.spouse_working = Boolean(patch.spouse_working);
  }

  patch.profile_self_updated_at = new Date().toISOString();
  if (body.mark_complete) {
    patch.profile_completed_at = new Date().toISOString();
  }
  patch.updated_at = new Date().toISOString();

  // Upsert — most staff already have a row from create-employee, but new
  // users created without an HR profile (e.g. legacy imports) shouldn't
  // hit a "not found" on first save.
  const { data: existing } = await supabase
    .from("hr_employee_profiles")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();

  let result;
  if (existing) {
    const r = await supabase
      .from("hr_employee_profiles")
      .update(patch)
      .eq("user_id", session.id)
      .select()
      .single();
    result = r;
  } else {
    const r = await supabase
      .from("hr_employee_profiles")
      .insert({ user_id: session.id, ...patch })
      .select()
      .single();
    result = r;
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: result.data });
}
