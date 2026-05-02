import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET — admin queue: list swap requests, filter by status, enrich with names + shift dates.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Real workflow statuses (set by staff app /api/hr/swap):
  //   pending_consent   — request sent, target hasn't accepted yet
  //   pending_approval  — target consented, waiting for admin
  //   approved / rejected / cancelled / consent_declined
  // The admin queue defaults to "actionable" = both pending states.
  const status = new URL(req.url).searchParams.get("status") || "actionable";

  let q = hrSupabaseAdmin
    .from("hr_shift_swap_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (status === "actionable") {
    q = q.in("status", ["pending_consent", "pending_approval"]);
  } else if (status !== "all") {
    q = q.eq("status", status);
  }
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate with names + shift details
  const userIds = Array.from(new Set((rows || []).flatMap((r: { requester_id: string; target_id: string }) => [r.requester_id, r.target_id])));
  const shiftIds = Array.from(new Set((rows || []).flatMap((r: { requester_shift_id: string; target_shift_id: string }) => [r.requester_shift_id, r.target_shift_id])));

  const [users, shifts] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : [],
    shiftIds.length
      ? hrSupabaseAdmin
          .from("hr_schedule_shifts")
          .select("id, shift_date, start_time, end_time")
          .in("id", shiftIds)
      : { data: [] as Array<{ id: string }> },
  ]);
  const shiftRows = "data" in shifts ? shifts.data || [] : shifts;
  const userMap = new Map(users.map((u) => [u.id, u.fullName || u.name || u.id.slice(0, 8)]));
  const shiftMap = new Map((shiftRows || []).map((s: { id: string }) => [s.id, s]));

  const enriched = (rows || []).map((r: {
    requester_id: string; target_id: string;
    requester_shift_id: string; target_shift_id: string;
  }) => ({
    ...r,
    requester_name: userMap.get(r.requester_id) || r.requester_id.slice(0, 8),
    target_name: userMap.get(r.target_id) || r.target_id.slice(0, 8),
    requester_shift: shiftMap.get(r.requester_shift_id) || null,
    target_shift: shiftMap.get(r.target_shift_id) || null,
  }));
  return NextResponse.json({ requests: enriched });
}

// PATCH — approve / reject. body: { swap_id, action, rejection_reason? }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { swap_id, action, rejection_reason } = body || {};
  if (!swap_id || !action) return NextResponse.json({ error: "swap_id and action required" }, { status: 400 });
  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }

  const { data: swap, error: getErr } = await hrSupabaseAdmin
    .from("hr_shift_swap_requests")
    .select("*")
    .eq("id", swap_id)
    .single();
  if (getErr || !swap) return NextResponse.json({ error: "Swap not found" }, { status: 404 });
  // Admin can only act on swaps the target has already consented to (pending_approval).
  // pending_consent means the target hasn't even said yes yet — nothing to approve.
  // Reject is also allowed from pending_consent so admin can short-circuit a bad request.
  const reviewableForApprove = ["pending_approval"];
  const reviewableForReject = ["pending_consent", "pending_approval"];
  const reviewable = action === "approve" ? reviewableForApprove : reviewableForReject;
  if (!reviewable.includes(swap.status)) {
    return NextResponse.json({ error: `Cannot ${action} swap in status ${swap.status}` }, { status: 400 });
  }

  if (action === "reject") {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_shift_swap_requests")
      .update({
        status: "rejected",
        rejection_reason: rejection_reason || null,
        approved_by: session.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", swap_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ swap: data });
  }

  // Approve — swap the user_ids on both shifts atomically(ish).
  const [{ data: rShift }, { data: tShift }] = await Promise.all([
    hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id").eq("id", swap.requester_shift_id).single(),
    hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id").eq("id", swap.target_shift_id).single(),
  ]);
  if (!rShift || !tShift) {
    return NextResponse.json({ error: "Underlying shifts no longer exist" }, { status: 400 });
  }
  await hrSupabaseAdmin.from("hr_schedule_shifts").update({ user_id: tShift.user_id }).eq("id", swap.requester_shift_id);
  await hrSupabaseAdmin.from("hr_schedule_shifts").update({ user_id: rShift.user_id }).eq("id", swap.target_shift_id);

  const { data, error } = await hrSupabaseAdmin
    .from("hr_shift_swap_requests")
    .update({
      status: "approved",
      approved_by: session.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", swap_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ swap: data });
}
