import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows (screen shows empty). Access stays scoped by the
// getSession gate + the per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my leave balances + requests
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year = new Date().getFullYear();

  const [balancesRes, requestsRes, policiesRes] = await Promise.all([
    supabase
      .from("hr_leave_balances")
      .select("*")
      .eq("user_id", session.id)
      .eq("year", year),
    supabase
      .from("hr_leave_requests")
      .select("*")
      .eq("user_id", session.id)
      .order("created_at", { ascending: false })
      .limit(20),
    // Active policies drive which leave types require a supporting document
    // (e.g. sick → MC). The form reads mandatory_attachment off this.
    supabase
      .from("hr_leave_policies")
      .select("leave_type, display_name, mandatory_attachment")
      .eq("is_active", true),
  ]);

  // hr_leave_balances stores entitled/used/pending/carried_forward but not the
  // "remaining" headline the app shows, so compute it: what the staff can still
  // take = entitled + carried forward, minus used and pending. Values come back
  // as numeric strings, so coerce.
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const balances = (balancesRes.data || []).map((b: Record<string, unknown>) => ({
    ...b,
    remaining_days:
      num(b.entitled_days) + num(b.carried_forward) - num(b.used_days) - num(b.pending_days),
  }));

  // Sign each request's stored attachment path so the staffer can re-open the
  // document they submitted. attachment_url holds a PRIVATE-bucket object path
  // (see the attachment route), not a public URL — sign it, don't link it raw.
  const rawRequests = (requestsRes.data || []) as Array<{ attachment_url: string | null; [k: string]: unknown }>;
  const requests = await Promise.all(
    rawRequests.map(async (r) => {
      if (!r.attachment_url) return { ...r, attachment_signed_url: null };
      const { data } = await supabase.storage
        .from("hr-documents")
        .createSignedUrl(r.attachment_url, 3600);
      return { ...r, attachment_signed_url: data?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({
    balances,
    requests,
    policies: policiesRes.data || [],
  });
}

// POST: submit a leave request (AI processes inline)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { leave_type, start_date, end_date, total_days, reason } = body;
  // attachment_url, when present, is the PRIVATE-bucket object path returned by
  // POST /api/hr/leave/attachment — never a client-supplied public URL.
  const attachment_url: string | null =
    typeof body.attachment_url === "string" && body.attachment_url.trim() ? body.attachment_url.trim() : null;

  if (!leave_type || !start_date || !end_date || !total_days) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Date sanity — end must be on or after start. Without this guard the
  // AI leave manager will happily auto-approve bogus ranges and decrement
  // the user's balance.
  if (end_date < start_date) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
  }

  // Recompute total_days server-side instead of trusting the client value.
  const inclusiveDays = Math.floor(
    (new Date(`${end_date}T00:00:00Z`).getTime() - new Date(`${start_date}T00:00:00Z`).getTime()) / 86400000,
  ) + 1;
  if (inclusiveDays < 1 || inclusiveDays > 365) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const safeTotalDays = Math.min(Number(total_days) || inclusiveDays, inclusiveDays);

  // Does this leave type require a supporting document (e.g. MC for sick leave)?
  const { data: policy } = await supabase
    .from("hr_leave_policies")
    .select("mandatory_attachment")
    .eq("leave_type", leave_type)
    .eq("is_active", true)
    .maybeSingle();
  const docRequiredButMissing = !!policy?.mandatory_attachment && !attachment_url;

  // Create the leave request
  const { data: request, error } = await supabase
    .from("hr_leave_requests")
    .insert({
      user_id: session.id,
      leave_type,
      start_date,
      end_date,
      total_days: safeTotalDays,
      reason: reason || null,
      attachment_url,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Policy requires a document but none was attached (e.g. native app, which
  // can't attach yet). Do NOT auto-approve — route straight to a manager for
  // manual handling / chasing the MC. We escalate rather than reject so the
  // request isn't lost and the staffer isn't hard-blocked.
  if (docRequiredButMissing) {
    await supabase
      .from("hr_leave_requests")
      .update({
        status: "ai_escalated",
        ai_decision: "escalate",
        ai_reason: "Supporting document required (e.g. MC) — none attached. Sent for manual review.",
        ai_processed_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    return NextResponse.json({
      request: {
        ...request,
        status: "ai_escalated",
        decision: "escalate",
        ai_decision: "escalate",
      },
    });
  }

  // Trigger AI Leave Manager via backoffice API
  // For now, we call it directly since the logic is in the same Supabase
  try {
    const { processLeaveRequest } = await import("@/lib/hr/agents/leave-manager");
    const decision = await processLeaveRequest(request.id);
    return NextResponse.json({ request: { ...request, ...decision } });
  } catch {
    // If AI processing fails, leave as pending for manual review
    return NextResponse.json({ request, aiError: "AI processing failed, submitted for manual review" });
  }
}
