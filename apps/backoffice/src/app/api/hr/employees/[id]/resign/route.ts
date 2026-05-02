import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/hr/employees/[id]/resign
// Body: { resigned_at: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD', reason?: string }
// - resigned_at = the date the resignation letter was submitted
// - end_date    = last working day (after notice period)
// Flips User.status → DEACTIVATED at end_date (via nightly cron) or immediately
// if end_date is today/past.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: userId } = await params;
  const body = await req.json();
  const { resigned_at, end_date, reason, force } = body as {
    resigned_at: string;
    end_date: string;
    reason?: string;
    force?: boolean;
  };

  if (!resigned_at || !end_date) {
    return NextResponse.json({ error: "resigned_at and end_date required" }, { status: 400 });
  }
  if (end_date < resigned_at) {
    return NextResponse.json({ error: "end_date must be on/after resigned_at" }, { status: 400 });
  }

  // Block on outstanding company assets unless explicitly forced. The UI shows
  // a warning before this point; this enforces it server-side so a malicious
  // direct API call can't bypass clearance.
  if (!force) {
    const { data: outstanding } = await hrSupabaseAdmin
      .from("hr_company_assets")
      .select("id, asset_type, description")
      .eq("user_id", userId)
      .eq("status", "issued");
    if (outstanding && outstanding.length > 0) {
      return NextResponse.json(
        {
          error: `${outstanding.length} outstanding asset(s) must be returned (or pass force:true to override).`,
          outstanding_assets: outstanding,
        },
        { status: 409 },
      );
    }
  }

  // Load existing notes so we can append, not overwrite. Previous personal
  // notes / disciplinary memos etc. must survive a resignation action.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("notes")
    .eq("user_id", userId)
    .maybeSingle();
  const stamp = reason ? `[Resigned ${end_date}] ${reason}` : `[Resigned ${end_date}]`;
  const mergedNotes = existing?.notes ? `${existing.notes}\n${stamp}` : stamp;

  // Persist on hr_employee_profiles (columns added earlier)
  const { error: profileErr } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .update({
      resigned_at,
      end_date,
      notes: mergedNotes,
    })
    .eq("user_id", userId);

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  // If end_date is today or past, deactivate immediately
  const today = new Date().toISOString().slice(0, 10);
  if (end_date <= today) {
    await prisma.user.update({ where: { id: userId }, data: { status: "DEACTIVATED" } });
  }

  return NextResponse.json({
    ok: true,
    resigned_at,
    end_date,
    auto_deactivated: end_date <= today,
  });
}

// DELETE /api/hr/employees/[id]/resign — cancel resignation (undo)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: userId } = await params;

  await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .update({ resigned_at: null, end_date: null })
    .eq("user_id", userId);

  // Reactivate if currently deactivated
  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });

  return NextResponse.json({ ok: true, reactivated: true });
}
