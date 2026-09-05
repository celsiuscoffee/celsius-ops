import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { canAccessOutlet } from "@/lib/hr/scope";
import { findCrossOutletOverlap } from "@/lib/hr/cross-outlet";

export const dynamic = "force-dynamic";

// hr_schedule_shifts has NO outlet_id column — the outlet lives on the parent
// hr_schedules row. This route selected `outlet_id` directly, so PostgREST
// errored, every shift came back null, MANAGERs were always 403 and
// OWNER/ADMIN always got "Underlying shifts no longer exist": no swap could be
// approved by anyone (2026-09-03 QA). Same join pattern as lib/hr/cross-outlet.
type ShiftRow = {
  id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  hr_schedules: { outlet_id: string; status?: string } | { outlet_id: string; status?: string }[] | null;
};
const SHIFT_SELECT = "id, user_id, shift_date, start_time, end_time, hr_schedules!inner(outlet_id, status)";
const outletOf = (s: ShiftRow | null | undefined): string | null => {
  if (!s?.hr_schedules) return null;
  const sched = Array.isArray(s.hr_schedules) ? s.hr_schedules[0] : s.hr_schedules;
  return sched?.outlet_id ?? null;
};
const flatten = (s: ShiftRow) => ({
  id: s.id, user_id: s.user_id, shift_date: s.shift_date, start_time: s.start_time, end_time: s.end_time, outlet_id: outletOf(s),
});

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
    .order("created_at", { ascending: false })
    .limit(500);
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

  const [users, shiftsRes] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : [],
    shiftIds.length
      ? hrSupabaseAdmin.from("hr_schedule_shifts").select(SHIFT_SELECT).in("id", shiftIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (shiftsRes.error) return NextResponse.json({ error: shiftsRes.error.message }, { status: 500 });
  const shiftRows = ((shiftsRes.data || []) as unknown as ShiftRow[]).map(flatten);
  const userMap = new Map(users.map((u) => [u.id, u.fullName || u.name || u.id.slice(0, 8)]));
  const shiftMap = new Map(shiftRows.map((s) => [s.id, s]));

  let enriched = (rows || []).map((r: {
    requester_id: string; target_id: string;
    requester_shift_id: string; target_shift_id: string;
  }) => ({
    ...r,
    requester_name: userMap.get(r.requester_id) || r.requester_id.slice(0, 8),
    target_name: userMap.get(r.target_id) || r.target_id.slice(0, 8),
    requester_shift: shiftMap.get(r.requester_shift_id) || null,
    target_shift: shiftMap.get(r.target_shift_id) || null,
  }));

  // MANAGER sees only swaps whose requester shift sits in their outlet scope.
  if (session.role === "MANAGER") {
    const checks = await Promise.all(
      enriched.map(async (r) => {
        const outletId = r.requester_shift?.outlet_id;
        return outletId ? canAccessOutlet(session, outletId) : false;
      }),
    );
    enriched = enriched.filter((_, i) => checks[i]);
  }
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

  // MANAGER can only act on swaps inside their outlet scope — a cross-outlet
  // swap needs access to BOTH sides, and reject is gated the same as approve.
  const [{ data: rRaw }, { data: tRaw }] = await Promise.all([
    hrSupabaseAdmin.from("hr_schedule_shifts").select(SHIFT_SELECT).eq("id", swap.requester_shift_id).maybeSingle(),
    hrSupabaseAdmin.from("hr_schedule_shifts").select(SHIFT_SELECT).eq("id", swap.target_shift_id).maybeSingle(),
  ]);
  const rShift = rRaw ? flatten(rRaw as unknown as ShiftRow) : null;
  const tShift = tRaw ? flatten(tRaw as unknown as ShiftRow) : null;
  if (session.role === "MANAGER") {
    const [reqOk, tgtOk] = await Promise.all([
      rShift?.outlet_id ? canAccessOutlet(session, rShift.outlet_id) : Promise.resolve(false),
      tShift?.outlet_id ? canAccessOutlet(session, tShift.outlet_id) : Promise.resolve(false),
    ]);
    if (!reqOk || !tgtOk) {
      return NextResponse.json(
        { error: "Forbidden — managers can only act on swaps for their assigned outlets" },
        { status: 403 },
      );
    }
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
      .in("status", reviewableForReject)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Swap was already decided" }, { status: 409 });
    return NextResponse.json({ swap: data });
  }

  // Approve — swap the user_ids on both shifts.
  if (!rShift || !tShift) {
    return NextResponse.json({ error: "Underlying shifts no longer exist" }, { status: 400 });
  }
  if (rShift.user_id !== swap.requester_id || tShift.user_id !== swap.target_id) {
    return NextResponse.json({ error: "The shifts have changed hands since this swap was requested — reject it and ask for a new one" }, { status: 409 });
  }
  // Each person must be free at the OTHER outlet that day (one outlet per day,
  // owner rule 2026-07-19). The old approve moved the rows blind, so a swap
  // could double-book someone across outlets.
  const [tConflict, rConflict] = await Promise.all([
    findCrossOutletOverlap(swap.target_id, rShift.shift_date, rShift.outlet_id ?? "", rShift.start_time, rShift.end_time),
    findCrossOutletOverlap(swap.requester_id, tShift.shift_date, tShift.outlet_id ?? "", tShift.start_time, tShift.end_time),
  ]);
  if (tConflict) {
    return NextResponse.json({ error: `Cannot approve — the target is already rostered at ${tConflict.outletName} on ${rShift.shift_date}`, conflict: tConflict }, { status: 409 });
  }
  if (rConflict) {
    return NextResponse.json({ error: `Cannot approve — the requester is already rostered at ${rConflict.outletName} on ${tShift.shift_date}`, conflict: rConflict }, { status: 409 });
  }

  // is_ai_assigned resets: after a human-approved swap these are human
  // decisions, and the AI fill must not treat them as its own to move.
  // Two writes; the second is checked and the first is reverted if it fails,
  // so a half-swap (one person holding both shifts) cannot persist.
  const { error: e1 } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .update({ user_id: tShift.user_id, is_ai_assigned: false })
    .eq("id", swap.requester_shift_id)
    .eq("user_id", rShift.user_id);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const { error: e2 } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .update({ user_id: rShift.user_id, is_ai_assigned: false })
    .eq("id", swap.target_shift_id)
    .eq("user_id", tShift.user_id);
  if (e2) {
    await hrSupabaseAdmin.from("hr_schedule_shifts").update({ user_id: rShift.user_id }).eq("id", swap.requester_shift_id);
    return NextResponse.json({ error: `Swap reverted — ${e2.message}` }, { status: 500 });
  }

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
