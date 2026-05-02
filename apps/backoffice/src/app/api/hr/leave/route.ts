import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET: list leave requests (for admin/manager review)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "ai_escalated";

  const visibleIds = await resolveVisibleUserIds(session);

  let query = hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (status !== "all") query = query.eq("status", status);
  if (visibleIds !== null) {
    if (visibleIds.length === 0) return NextResponse.json({ requests: [] });
    query = query.in("user_id", visibleIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with user name + outlet for display
  const userIds = Array.from(new Set((data || []).map((r: { user_id: string }) => r.user_id)));
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, fullName: true, outlet: { select: { name: true } } },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const requests = (data || []).map((r: { user_id: string; [k: string]: unknown }) => {
    const u = userMap.get(r.user_id);
    return {
      ...r,
      user_name: u?.fullName || u?.name || null,
      outlet_name: u?.outlet?.name || null,
    };
  });

  return NextResponse.json({ requests });
}

// PATCH: approve or reject an escalated leave request
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, action, reason } = body as { id: string; action: "approve" | "reject"; reason?: string };

  if (action === "approve") {
    // Get the request to update balance + verify it's still actionable.
    const { data: request } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("user_id, leave_type, total_days, status, start_date")
      .eq("id", id)
      .single();
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    // Guard: only re-approve from a pending state. Without this, double-clicks
    // and stale UI state double-deduct used_days from the leave balance.
    if (!["pending", "ai_escalated"].includes(request.status)) {
      return NextResponse.json(
        { error: `Cannot approve a request in status '${request.status}'` },
        { status: 400 },
      );
    }

    // MANAGER can only act on their direct reports
    if (session.role === "MANAGER" && request) {
      const visibleIds = await resolveVisibleUserIds(session);
      if (!visibleIds || !visibleIds.includes(request.user_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .update({
        status: "approved",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update balance: move from pending to used. Use the leave's start_date
    // year so cross-year requests (e.g. Dec 28 – Jan 3 approved on Jan 1) hit
    // the correct annual bucket — otherwise statutory days drift across years.
    if (request) {
      const year = new Date(request.start_date).getFullYear();
      const { data: balance } = await hrSupabaseAdmin
        .from("hr_leave_balances")
        .select("*")
        .eq("user_id", request.user_id)
        .eq("year", year)
        .eq("leave_type", request.leave_type)
        .maybeSingle();

      if (balance) {
        await hrSupabaseAdmin
          .from("hr_leave_balances")
          .update({
            used_days: Number(balance.used_days) + Number(request.total_days),
            pending_days: Math.max(0, Number(balance.pending_days) - Number(request.total_days)),
          })
          .eq("id", balance.id);
      }
    }

    return NextResponse.json({ success: true });
  }

  if (action === "reject") {
    // Get the request to release pending balance.
    const { data: request } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("user_id, leave_type, total_days, status, start_date")
      .eq("id", id)
      .single();
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    // Guard: rejecting an already-approved request must restore used_days back
    // to the bank (otherwise we leak days). For now, only allow rejection from
    // pending states — surface a clear error for the operator.
    if (!["pending", "ai_escalated"].includes(request.status)) {
      return NextResponse.json(
        { error: `Cannot reject a request in status '${request.status}' — cancel/restore the approved request instead.` },
        { status: 400 },
      );
    }

    // MANAGER can only act on their direct reports
    if (session.role === "MANAGER" && request) {
      const visibleIds = await resolveVisibleUserIds(session);
      if (!visibleIds || !visibleIds.includes(request.user_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .update({
        status: "rejected",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || null,
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Release pending days — using the leave's start_date year, not "today",
    // so cross-year requests release from the correct annual bucket.
    if (request) {
      const year = new Date(request.start_date).getFullYear();
      const { data: balance } = await hrSupabaseAdmin
        .from("hr_leave_balances")
        .select("*")
        .eq("user_id", request.user_id)
        .eq("year", year)
        .eq("leave_type", request.leave_type)
        .maybeSingle();

      if (balance) {
        await hrSupabaseAdmin
          .from("hr_leave_balances")
          .update({
            pending_days: Math.max(0, Number(balance.pending_days) - Number(request.total_days)),
          })
          .eq("id", balance.id);
      }
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
