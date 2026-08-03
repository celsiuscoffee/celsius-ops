import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { decideRateChange, isPtRateType, profileColumnFor } from "@/lib/hr/pt-rate-change";

export const dynamic = "force-dynamic";

// salary_type values the DATABASE accepts. The check constraint on
// hr_salary_history is ('monthly','hourly','daily') + 'hourly_weekend' as of
// the 20260802 migration. The route previously validated against
// ('base','allowance','bonus','increment',...) — four values Postgres would
// have rejected, and 'base' (the one that mirrored to basic_salary) was never
// storable at all. Live data is 44 'monthly' + 31 'hourly' rows.
const SALARY_TYPES = ["monthly", "hourly", "hourly_weekend", "daily"] as const;

/** The live-profile column a salary_type writes through to, if any. */
function mirrorColumn(salaryType: string): string | null {
  if (salaryType === "monthly") return "basic_salary";
  if (isPtRateType(salaryType)) return profileColumnFor(salaryType);
  return null;
}

async function loadTarget(userId: string) {
  const { data } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { user_id: string; employment_type: string | null } | null;
}

// GET — list salary history for a user (most recent first).
//
// OWNER/ADMIN see everything. A MANAGER sees only the HOURLY rows of a
// part-timer inside their own subtree — never monthly salary, and never
// somebody else's team. Compensation stays owner-only by default.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const isOwnerAdmin = ["OWNER", "ADMIN"].includes(session.role);
  if (!isOwnerAdmin) {
    const [visible, target] = await Promise.all([resolveVisibleUserIds(session), loadTarget(id)]);
    if (!target || target.employment_type !== "part_time") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (visible !== null && !visible.includes(id)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let q = hrSupabaseAdmin.from("hr_salary_history").select("*").eq("user_id", id);
  if (!isOwnerAdmin) q = q.in("salary_type", ["hourly", "hourly_weekend"]);

  const { data, error } = await q.order("effective_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data, scope: isOwnerAdmin ? "all" : "pt-hourly" });
}

// POST — log a salary change (increment, promotion, restructure).
// body: { effective_date, salary_type, amount, comment? }
//
// A MANAGER may set a part-timer's hourly rate; above the RM11 ceiling the row
// is stored `pending` and does NOT touch the live profile, so payroll cannot
// pick it up until an OWNER/ADMIN approves via PATCH.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const { effective_date, salary_type, amount, comment } = body || {};
  if (!effective_date || !salary_type || amount == null) {
    return NextResponse.json({ error: "effective_date, salary_type, amount required" }, { status: 400 });
  }
  if (!(SALARY_TYPES as readonly string[]).includes(salary_type)) {
    return NextResponse.json({ error: `Invalid salary_type: ${salary_type}` }, { status: 400 });
  }

  const [visibleUserIds, target] = await Promise.all([
    resolveVisibleUserIds(session),
    loadTarget(id),
  ]);
  if (!target) return NextResponse.json({ error: "No HR profile for this employee" }, { status: 404 });

  const decision = decideRateChange(
    { role: session.role, visibleUserIds },
    target,
    salary_type,
    Number(amount),
  );
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: 403 });
  }
  const { status } = decision;

  // Only a change that takes effect NOW supersedes the previous open row. A
  // pending request must not close the rate the employee is currently paid —
  // otherwise a request awaiting approval would silently end the live rate.
  if (status === "approved") {
    await hrSupabaseAdmin
      .from("hr_salary_history")
      .update({ end_date: effective_date })
      .eq("user_id", id)
      .eq("salary_type", salary_type)
      .eq("status", "approved")
      .is("end_date", null)
      .lt("effective_date", effective_date);
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_salary_history")
    .insert({
      user_id: id,
      effective_date,
      salary_type,
      amount: Number(amount),
      comment: comment || null,
      created_by: session.id,
      requested_by: session.id,
      status,
      ...(status === "approved" && ["OWNER", "ADMIN"].includes(session.role)
        ? { approved_by: session.id, approved_at: new Date().toISOString() }
        : {}),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mirror onto the live profile so payroll picks it up — approved rows only,
  // and only once the effective date has arrived.
  const column = mirrorColumn(salary_type);
  if (status === "approved" && column && Date.parse(effective_date) <= Date.now()) {
    await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ [column]: Number(amount) })
      .eq("user_id", id);
  }

  return NextResponse.json({ entry: data, status, message: decision.reason });
}

// PATCH — OWNER/ADMIN approves or rejects a pending rate change.
// body: { entry_id, action: "approve" | "reject", reason? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Only an owner or admin can approve a pay change" }, { status: 403 });
  }
  const { id } = await params;
  const { entry_id, action, reason } = (await req.json()) || {};
  if (!entry_id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "entry_id and action (approve|reject) required" }, { status: 400 });
  }

  const { data: entry } = await hrSupabaseAdmin
    .from("hr_salary_history")
    .select("*")
    .eq("id", entry_id)
    .eq("user_id", id)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  if (entry.status !== "pending") {
    return NextResponse.json({ error: `This change is already ${entry.status}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  if (action === "reject") {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_salary_history")
      .update({ status: "rejected", approved_by: session.id, approved_at: now, rejected_reason: reason || null })
      .eq("id", entry_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: data, status: "rejected" });
  }

  // Approving is the moment the change becomes real: close the superseded row,
  // flip to approved, then mirror to the profile.
  await hrSupabaseAdmin
    .from("hr_salary_history")
    .update({ end_date: entry.effective_date })
    .eq("user_id", id)
    .eq("salary_type", entry.salary_type)
    .eq("status", "approved")
    .is("end_date", null)
    .lt("effective_date", entry.effective_date);

  const { data, error } = await hrSupabaseAdmin
    .from("hr_salary_history")
    .update({ status: "approved", approved_by: session.id, approved_at: now })
    .eq("id", entry_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const column = mirrorColumn(entry.salary_type);
  if (column && Date.parse(entry.effective_date) <= Date.now()) {
    await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ [column]: Number(entry.amount) })
      .eq("user_id", id);
  }

  return NextResponse.json({ entry: data, status: "approved" });
}

// DELETE — OWNER/ADMIN can remove any entry. A MANAGER can only withdraw a
// PENDING request they raised themselves; settled pay history is not theirs to
// edit.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const entryId = new URL(req.url).searchParams.get("entry_id");
  if (!entryId) return NextResponse.json({ error: "entry_id required" }, { status: 400 });

  let q = hrSupabaseAdmin.from("hr_salary_history").delete().eq("id", entryId).eq("user_id", id);
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    q = q.eq("status", "pending").eq("requested_by", session.id);
  }

  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Nothing removed — you can only withdraw your own pending request." },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
