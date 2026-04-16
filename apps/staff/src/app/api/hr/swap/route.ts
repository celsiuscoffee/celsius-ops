import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my swap requests (sent + received)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [sentRes, receivedRes] = await Promise.all([
    supabase
      .from("hr_shift_swap_requests")
      .select("*, requester_shift:hr_schedule_shifts!requester_shift_id(*), target_shift:hr_schedule_shifts!target_shift_id(*)")
      .eq("requester_id", session.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("hr_shift_swap_requests")
      .select("*, requester_shift:hr_schedule_shifts!requester_shift_id(*), target_shift:hr_schedule_shifts!target_shift_id(*)")
      .eq("target_id", session.id)
      .eq("status", "pending_consent")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    sent: sentRes.data || [],
    pendingConsent: receivedRes.data || [],
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
    const { my_shift_id, target_shift_id, target_id, reason } = body;

    if (!my_shift_id || !target_shift_id || !target_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify both shifts exist and belong to the right people
    const [myShift, targetShift] = await Promise.all([
      supabase.from("hr_schedule_shifts").select("*").eq("id", my_shift_id).eq("user_id", session.id).single(),
      supabase.from("hr_schedule_shifts").select("*").eq("id", target_shift_id).eq("user_id", target_id).single(),
    ]);

    if (!myShift.data || !targetShift.data) {
      return NextResponse.json({ error: "Invalid shift selection" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("hr_shift_swap_requests")
      .insert({
        requester_id: session.id,
        requester_shift_id: my_shift_id,
        target_id,
        target_shift_id,
        reason: reason || null,
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
      .single();

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
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ swap: data });
    }
  }

  // ─── Cancel own request ───
  if (action === "cancel") {
    const { swap_id } = body;

    const { error } = await supabase
      .from("hr_shift_swap_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", swap_id)
      .eq("requester_id", session.id)
      .in("status", ["pending_consent", "pending_approval"]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
