import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { logActivity } from "@/lib/activity-log";

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
  const { id, action, reason, allow_negative_balance } = body as {
    id: string; action: "approve" | "reject"; reason?: string; allow_negative_balance?: boolean;
  };

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

    // Balance guard — this PATCH is the ONLY approval gate while the AI
    // leave-manager escalates, and it historically validated nothing: any
    // approval went through even past the entitlement. Overdraw (or a missing
    // balance row, which would silently skip the balance move below and burn no
    // days at all) now requires an explicit allow_negative_balance from the
    // operator, and that override is activity-logged. "unpaid" leave is exempt —
    // it has no meaningful entitlement to overdraw.
    if (request.leave_type !== "unpaid") {
      const guardYear = new Date(request.start_date).getFullYear();
      const { data: guardBalance } = await hrSupabaseAdmin
        .from("hr_leave_balances")
        .select("entitled_days, carried_forward, used_days, pending_days")
        .eq("user_id", request.user_id)
        .eq("year", guardYear)
        .eq("leave_type", request.leave_type)
        .maybeSingle();

      if (!guardBalance && !allow_negative_balance) {
        return NextResponse.json(
          {
            error: `No ${request.leave_type} balance row exists for ${guardYear} — approving would burn no days. Initialize leave balances first, or pass allow_negative_balance to approve anyway.`,
            reason: "no_balance_row",
          },
          { status: 409 },
        );
      }
      if (guardBalance) {
        // Other pending requests hold days too (pending_days already includes
        // THIS request's hold, so subtract the hold as a whole, not this
        // request twice). Two 5-day requests against 6 remaining days used to
        // both pass because each only saw used_days.
        const otherPending = Math.max(0, Number(guardBalance.pending_days ?? 0) - Number(request.total_days));
        const remainingAfter =
          Number(guardBalance.entitled_days) + Number(guardBalance.carried_forward) -
          Number(guardBalance.used_days) - otherPending - Number(request.total_days);
        if (remainingAfter < 0 && !allow_negative_balance) {
          return NextResponse.json(
            {
              error: `Approving ${request.total_days} day(s) overdraws the ${request.leave_type} balance by ${Math.abs(remainingAfter)} day(s). Pass allow_negative_balance to approve anyway.`,
              reason: "insufficient_balance",
              overdraw_days: Math.abs(remainingAfter),
            },
            { status: 409 },
          );
        }
      }
      if (allow_negative_balance) {
        await logActivity({
          actorId: session.id,
          action: "leave.approve_negative_balance",
          module: "hr",
          targetId: id,
          targetName: `${request.leave_type} ${request.start_date} (${request.total_days}d)`,
          details: { user_id: request.user_id, had_balance_row: !!guardBalance },
          request: req,
        });
      }
    }

    // Compare-and-set on the status: the read above and this write are two
    // round trips, so a double-click or two managers approving at once both
    // passed the guard and both banked used_days. Zero rows = someone else won.
    const { data: approvedRows, error } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .update({
        status: "approved",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["pending", "ai_escalated"])
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!approvedRows || approvedRows.length === 0) {
      return NextResponse.json({ error: "This request was already decided" }, { status: 409 });
    }

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

    const { data: rejectedRows, error } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .update({
        status: "rejected",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || null,
      })
      .eq("id", id)
      .in("status", ["pending", "ai_escalated"])
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rejectedRows || rejectedRows.length === 0) {
      return NextResponse.json({ error: "This request was already decided" }, { status: 409 });
    }

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
