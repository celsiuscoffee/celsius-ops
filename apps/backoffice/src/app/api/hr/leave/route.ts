import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// GET: list leave requests (for admin review)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "ai_escalated";

  let query = hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data });
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
    // Get the request to update balance
    const { data: request } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("user_id, leave_type, total_days")
      .eq("id", id)
      .single();

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .update({
        status: "approved",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update balance: move from pending to used
    if (request) {
      const year = new Date().getFullYear();
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
    // Get the request to release pending balance
    const { data: request } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("user_id, leave_type, total_days")
      .eq("id", id)
      .single();

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

    // Release pending days
    if (request) {
      const year = new Date().getFullYear();
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
