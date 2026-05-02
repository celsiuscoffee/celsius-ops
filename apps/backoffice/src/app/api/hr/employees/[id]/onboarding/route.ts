import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// GET — onboarding checklist for one employee. Joins active templates with
// the user's progress, returning each task with completed_at/by populated.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Need profile for employment_type filter
  const { data: profile } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("employment_type, join_date")
    .eq("user_id", id)
    .maybeSingle();

  const [{ data: templates }, { data: progress }] = await Promise.all([
    hrSupabaseAdmin
      .from("hr_onboarding_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
    hrSupabaseAdmin
      .from("hr_onboarding_progress")
      .select("template_id, completed_at, completed_by, note")
      .eq("user_id", id),
  ]);

  const progByTpl = new Map((progress || []).map((p: { template_id: string }) => [p.template_id, p]));

  const empType = profile?.employment_type || "full_time";
  const filtered = (templates || []).filter((t: { applies_to_employment_types: string[] }) =>
    !t.applies_to_employment_types || t.applies_to_employment_types.includes(empType),
  );
  const enriched = filtered.map((t: { id: string }) => ({
    ...t,
    progress: progByTpl.get(t.id) || null,
  }));

  return NextResponse.json({ tasks: enriched, profile });
}

// POST — toggle completion of a task. body: { template_id, completed: bool, note? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const { template_id, completed, note } = body || {};
  if (!template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });

  if (completed === false) {
    // Un-tick: delete the progress row.
    const { error } = await hrSupabaseAdmin
      .from("hr_onboarding_progress")
      .delete()
      .eq("user_id", id)
      .eq("template_id", template_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_onboarding_progress")
    .upsert(
      {
        user_id: id,
        template_id,
        completed_at: new Date().toISOString(),
        completed_by: session.id,
        note: note || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,template_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ progress: data });
}
