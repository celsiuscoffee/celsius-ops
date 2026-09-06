import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows (screen shows empty). Access stays scoped by the
// getSession gate + the per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getMYTToday } from "@/lib/hr/constants";
import { isRestRow, SWAPPABLE_SELECT, type SwappableShiftRow, flattenSwappable } from "@/lib/hr/swap-shared";

export const dynamic = "force-dynamic";

const SWAP_SELECT =
  "*, requester_shift:hr_schedule_shifts!requester_shift_id(*), target_shift:hr_schedule_shifts!target_shift_id(*)";

// GET: my swap requests (sent + received), with the other person's name —
// "2026-09-12 ↔ 2026-09-14" on its own never said WHO the swap was with.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [sentRes, receivedRes] = await Promise.all([
    supabase
      .from("hr_shift_swap_requests")
      .select(SWAP_SELECT)
      .eq("requester_id", session.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("hr_shift_swap_requests")
      .select(SWAP_SELECT)
      .eq("target_id", session.id)
      .eq("status", "pending_consent")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const sent = (sentRes.data || []) as Array<Record<string, unknown> & { requester_id: string; target_id: string }>;
  const received = (receivedRes.data || []) as Array<Record<string, unknown> & { requester_id: string; target_id: string }>;
  const userIds = Array.from(new Set([...sent, ...received].flatMap((r) => [r.requester_id, r.target_id])));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.name]));
  const withNames = (r: (typeof sent)[number]) => ({
    ...r,
    requester_name: nameById.get(r.requester_id) ?? null,
    target_name: nameById.get(r.target_id) ?? null,
  });

  return NextResponse.json({
    sent: sent.map(withNames),
    pendingConsent: received.map(withNames),
  });
}

// POST: create a swap request OR respond to one
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  // ─── Create new swap request ───
  if (action === "request") {
    const { my_shift_id, target_shift_id, target_id, reason } = body as {
      my_shift_id?: string; target_shift_id?: string; target_id?: string; reason?: string;
    };

    if (!my_shift_id || !target_shift_id || !target_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (target_id === session.id || my_shift_id === target_shift_id) {
      return NextResponse.json({ error: "Pick a coworker's shift to swap with" }, { status: 400 });
    }

    // Both shifts must exist, belong to the right people, sit on PUBLISHED
    // rosters and still be ahead of us. The old check accepted any two rows —
    // a draft shift, a rest-day placeholder, or yesterday's shift — and the
    // manager only found out at approval time.
    const [myRes, targetRes] = await Promise.all([
      supabase.from("hr_schedule_shifts").select(SWAPPABLE_SELECT).eq("id", my_shift_id).eq("user_id", session.id).maybeSingle(),
      supabase.from("hr_schedule_shifts").select(SWAPPABLE_SELECT).eq("id", target_shift_id).eq("user_id", target_id).maybeSingle(),
    ]);
    const mine = myRes.data ? flattenSwappable(myRes.data as unknown as SwappableShiftRow) : null;
    const theirs = targetRes.data ? flattenSwappable(targetRes.data as unknown as SwappableShiftRow) : null;
    if (!mine || !theirs) {
      return NextResponse.json({ error: "Invalid shift selection" }, { status: 400 });
    }
    const today = getMYTToday();
    if (mine.status !== "published" || theirs.status !== "published") {
      return NextResponse.json({ error: "Only shifts on a published roster can be swapped" }, { status: 400 });
    }
    if (mine.shift_date <= today || theirs.shift_date <= today) {
      return NextResponse.json({ error: "Swaps need to be requested before the day of the shift" }, { status: 400 });
    }
    if (isRestRow(mine) || isRestRow(theirs)) {
      return NextResponse.json({ error: "A rest day can't be swapped — pick a working shift" }, { status: 400 });
    }
    if (mine.outlet_id !== theirs.outlet_id) {
      return NextResponse.json({ error: "Swaps are between shifts at the same outlet" }, { status: 400 });
    }

    // One open request per shift. A second request on a shift already in a
    // pending swap could be approved twice and move the row to the wrong person.
    const { data: open } = await supabase
      .from("hr_shift_swap_requests")
      .select("id, requester_shift_id, target_shift_id")
      .in("status", ["pending_consent", "pending_approval"])
      .or(
        `requester_shift_id.in.(${my_shift_id},${target_shift_id}),target_shift_id.in.(${my_shift_id},${target_shift_id})`,
      )
      .limit(1);
    if (open && open.length > 0) {
      return NextResponse.json(
        { error: "One of these shifts already has a swap request in progress. Cancel it first.", reason: "duplicate" },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("hr_shift_swap_requests")
      .insert({
        requester_id: session.id,
        requester_shift_id: my_shift_id,
        target_id,
        target_shift_id,
        reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null,
        status: "pending_consent",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ swap: data });
  }

  // ─── Target consents or declines ───
  if (action === "consent" || action === "decline") {
    const { swap_id, decline_reason } = body;

    // Verify this swap is for the current user
    const { data: swap } = await supabase
      .from("hr_shift_swap_requests")
      .select("*")
      .eq("id", swap_id)
      .eq("target_id", session.id)
      .eq("status", "pending_consent")
      .maybeSingle();

    if (!swap) {
      return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
    }

    if (action === "consent") {
      const { data, error } = await supabase
        .from("hr_shift_swap_requests")
        .update({
          status: "pending_approval",
          target_consented_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", swap_id)
        .eq("status", "pending_consent")
        .select()
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "This request was already withdrawn" }, { status: 409 });
      return NextResponse.json({ swap: data, message: "Consent given. Waiting for manager approval." });
    }

    if (action === "decline") {
      const { data, error } = await supabase
        .from("hr_shift_swap_requests")
        .update({
          status: "consent_declined",
          target_declined_at: new Date().toISOString(),
          target_decline_reason: decline_reason || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", swap_id)
        .eq("status", "pending_consent")
        .select()
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "This request was already withdrawn" }, { status: 409 });
      return NextResponse.json({ swap: data });
    }
  }

  // ─── Cancel own request ───
  if (action === "cancel") {
    const { swap_id } = body;

    const { data, error } = await supabase
      .from("hr_shift_swap_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", swap_id)
      .eq("requester_id", session.id)
      .in("status", ["pending_consent", "pending_approval"])
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "This request can no longer be cancelled" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
