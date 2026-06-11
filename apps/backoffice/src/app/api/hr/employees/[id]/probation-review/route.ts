import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// A MANAGER may only act on employees in their own subtree. OWNER/ADMIN: any.
async function assertCanSeeEmployee(
  session: { role: string; id: string },
  employeeId: string,
): Promise<NextResponse | null> {
  const visible = await resolveVisibleUserIds(session);
  if (visible !== null && !visible.includes(employeeId)) {
    return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
  }
  return null;
}

// GET — return all probation reviews for the staff (most recent first).
// Typical flow: there's only ever one "current" review; if extended, the
// extension creates a second review row. Both are useful in the audit trail.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const denied = await assertCanSeeEmployee(session, id);
  if (denied) return denied;
  const { data, error } = await hrSupabaseAdmin
    .from("hr_probation_reviews")
    .select("*")
    .eq("user_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reviews: data });
}

// POST — create a new review (typically status='draft' so the manager can
// keep editing). Set status='submitted' to lock it in.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const denied = await assertCanSeeEmployee(session, id);
  if (denied) return denied;
  const body = await req.json();
  const {
    attendance_score, performance_score, attitude_score, learning_score, overall_score,
    strengths, improvements, recommendation_notes,
    decision, extension_months, new_probation_end,
    status,
  } = body || {};

  if (!decision || !["confirm", "extend", "terminate"].includes(decision)) {
    return NextResponse.json({ error: "decision must be confirm|extend|terminate" }, { status: 400 });
  }
  if (decision === "extend" && (!extension_months || !new_probation_end)) {
    return NextResponse.json({ error: "extension_months and new_probation_end required when decision=extend" }, { status: 400 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_probation_reviews")
    .insert({
      user_id: id,
      reviewer_id: session.id,
      attendance_score: attendance_score ?? null,
      performance_score: performance_score ?? null,
      attitude_score: attitude_score ?? null,
      learning_score: learning_score ?? null,
      overall_score: overall_score ?? null,
      strengths: strengths || null,
      improvements: improvements || null,
      recommendation_notes: recommendation_notes || null,
      decision,
      extension_months: decision === "extend" ? extension_months : null,
      new_probation_end: decision === "extend" ? new_probation_end : null,
      status: status === "submitted" ? "submitted" : "draft",
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If decision=extend AND submitted, push the probation_end_date on the
  // employee profile so the rest of the system reflects the new date.
  if (decision === "extend" && status === "submitted" && new_probation_end) {
    await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ probation_end_date: new_probation_end, updated_at: new Date().toISOString() })
      .eq("user_id", id);
  }

  return NextResponse.json({ review: data });
}

// PATCH — update an existing draft, or approve a submitted review (OWNER/
// ADMIN only). Approving is what unlocks the confirmation-letter generator
// for decision=confirm reviews.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const denied = await assertCanSeeEmployee(session, id);
  if (denied) return denied;
  const body = await req.json();
  const { review_id, action, ...patchable } = body || {};
  if (!review_id) return NextResponse.json({ error: "review_id required" }, { status: 400 });

  // Fetch the existing review for permission + state checks.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_probation_reviews")
    .select("*")
    .eq("id", review_id)
    .eq("user_id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  if (action === "approve") {
    if (!["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Only OWNER/ADMIN can approve" }, { status: 403 });
    }
    if (existing.status !== "submitted") {
      return NextResponse.json({ error: "Review must be submitted before approval" }, { status: 409 });
    }
    const { data, error } = await hrSupabaseAdmin
      .from("hr_probation_reviews")
      .update({
        status: "approved",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", review_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ review: data });
  }

  // Otherwise, treat as a draft edit. Only allowed while status='draft'.
  if (existing.status !== "draft") {
    return NextResponse.json({ error: `Cannot edit review with status=${existing.status}` }, { status: 409 });
  }

  // Ownership: a MANAGER can only edit drafts they themselves wrote.
  // OWNER/ADMIN can edit any draft (e.g. typo fixes on behalf of a manager).
  if (session.role === "MANAGER" && existing.reviewer_id !== session.id) {
    return NextResponse.json(
      { error: "Forbidden — you can only edit your own draft reviews" },
      { status: 403 },
    );
  }

  const allowed = [
    "attendance_score", "performance_score", "attitude_score", "learning_score", "overall_score",
    "strengths", "improvements", "recommendation_notes",
    "decision", "extension_months", "new_probation_end",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in patchable) patch[k] = (patchable as Record<string, unknown>)[k] ?? null;
  if (patchable.status === "submitted") {
    patch.status = "submitted";
    patch.submitted_at = new Date().toISOString();
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_probation_reviews")
    .update(patch)
    .eq("id", review_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ review: data });
}
