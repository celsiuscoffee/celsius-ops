import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// GET: pending swap requests for manager approval
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_shift_swap_requests")
    .select("*, requester_shift:hr_schedule_shifts!requester_shift_id(*), target_shift:hr_schedule_shifts!target_shift_id(*)")
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ swaps: data });
}

// PATCH: manager approves or rejects a swap
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { swap_id, action, reason } = body as {
    swap_id: string;
    action: "approve" | "reject";
    reason?: string;
  };

  const { data: swap } = await hrSupabaseAdmin
    .from("hr_shift_swap_requests")
    .select("*")
    .eq("id", swap_id)
    .eq("status", "pending_approval")
    .single();

  if (!swap) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }

  if (action === "approve") {
    // Swap the user_ids on the two shifts
    const [reqShift, tgtShift] = await Promise.all([
      hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id").eq("id", swap.requester_shift_id).single(),
      hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id").eq("id", swap.target_shift_id).single(),
    ]);

    if (!reqShift.data || !tgtShift.data) {
      return NextResponse.json({ error: "Shifts not found" }, { status: 500 });
    }

    // Swap the assignments
    await Promise.all([
      hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .update({ user_id: tgtShift.data.user_id, is_ai_assigned: false })
        .eq("id", swap.requester_shift_id),
      hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .update({ user_id: reqShift.data.user_id, is_ai_assigned: false })
        .eq("id", swap.target_shift_id),
    ]);

    // Mark swap as approved
    await hrSupabaseAdmin
      .from("hr_shift_swap_requests")
      .update({
        status: "approved",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", swap_id);

    return NextResponse.json({ success: true, message: "Shifts swapped" });
  }

  if (action === "reject") {
    await hrSupabaseAdmin
      .from("hr_shift_swap_requests")
      .update({
        status: "rejected",
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", swap_id);

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
