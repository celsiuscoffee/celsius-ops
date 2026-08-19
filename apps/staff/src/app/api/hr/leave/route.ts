import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows (screen shows empty). Access stays scoped by the
// getSession gate + the per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { leaveDays, getMYTToday } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

// GET: my leave balances + requests
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Balance year from MYT — on Jan 1 before 08:00 MYT a UTC year is still last
  // year, so the app would show last year's balances for those hours.
  const year = Number(getMYTToday().slice(0, 4));

  const [balancesRes, requestsRes] = await Promise.all([
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
  ]);

  // hr_leave_balances stores entitled/used/pending/carried_forward but not the
  // "remaining" headline the app shows, so compute it: what the staff can still
  // take = entitled + carried forward, minus used and pending. Values come back
  // as numeric strings, so coerce.
  // Rounded here, at the source: this figure is rendered verbatim by BOTH the
  // staff web app and the native manager app (which reads remaining_days
  // straight off this response), so fixing it server-side covers both without
  // shipping a native build.
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const balances = (balancesRes.data || []).map((b: Record<string, unknown>) => ({
    ...b,
    entitled_days: leaveDays(num(b.entitled_days)),
    remaining_days: leaveDays(
      num(b.entitled_days) + num(b.carried_forward) - num(b.used_days) - num(b.pending_days),
    ),
  }));

  return NextResponse.json({
    balances,
    requests: requestsRes.data || [],
  });
}

// POST: submit a leave request (AI processes inline)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { leave_type, start_date, end_date, total_days, reason, attachment } = body;

  if (!leave_type || !start_date || !end_date || !total_days) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Sick leave must carry an MC. The column existed but nothing ever wrote it —
  // this route didn't even read an attachment off the body — so every sick leave
  // on record has attachment_url NULL and several were auto-approved on the
  // strength of a free-text reason alone.
  if (leave_type === "sick" && !attachment) {
    return NextResponse.json(
      { error: "Sick leave needs an MC. Attach a photo or PDF of the medical certificate.", reason: "mc_required" },
      { status: 400 },
    );
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
  // Clamp BOTH bounds. The old code capped only the top, so a crafted negative
  // total_days (-5) was stored verbatim and CREDITED the balance on approval
  // (used_days + (-5)), and a 0.01 burned nothing while blocking the range.
  // Valid values: half-day steps from 0.5 up to the inclusive calendar span.
  const requestedDays = Number(total_days);
  if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
    return NextResponse.json({ error: "total_days must be a positive number of days" }, { status: 400 });
  }
  const safeTotalDays = Math.min(Math.max(Math.round(requestedDays * 2) / 2, 0.5), inclusiveDays);

  // Store the MC in the same private bucket the attendance photos use, and keep
  // the object PATH rather than a URL — the bucket is private and the backoffice
  // mints a short-lived signed URL at read time (see the clock route's uploader).
  let attachmentPath: string | null = null;
  if (attachment) {
    const mime = /^data:([^;,]+)/.exec(attachment)?.[1] ?? "image/jpeg";
    const ALLOWED: Record<string, string> = {
      "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
      "image/heic": "heic", "image/webp": "webp", "application/pdf": "pdf",
    };
    const ext = ALLOWED[mime];
    if (!ext) {
      return NextResponse.json({ error: "MC must be a photo (JPG/PNG/HEIC/WebP) or a PDF" }, { status: 400 });
    }
    const base64 = attachment.includes(",") ? attachment.split(",")[1] : attachment;
    const buffer = Buffer.from(base64, "base64");
    // A phone photo is ~1-5MB; anything past 15MB is a mistake, and the request
    // body would be rejected upstream anyway.
    if (buffer.byteLength > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "MC file is too large (max 15MB)" }, { status: 400 });
    }
    const path = `leave-mc/${session.id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("hr-photos")
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (uploadErr) {
      // Never record the leave without the MC it was accepted on.
      return NextResponse.json({ error: `Could not upload the MC: ${uploadErr.message}` }, { status: 500 });
    }
    attachmentPath = path;
  }

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
      attachment_url: attachmentPath,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reserve the days at SUBMIT time, on the leave's start-year row (the approve
  // path banks used_days against that year). Every submit path must hold
  // pending_days because approve/reject RELEASE it unconditionally (clamped at
  // 0) — a request that never held eats the reservation of any other pending
  // request the person has. The AI leave-manager no longer holds on
  // auto-approve; this is now the single place the hold happens.
  const balanceYear = Number(String(start_date).slice(0, 4));
  const { data: holdBalance } = await supabase
    .from("hr_leave_balances")
    .select("id, pending_days")
    .eq("user_id", session.id)
    .eq("year", balanceYear)
    .eq("leave_type", leave_type)
    .maybeSingle();
  if (holdBalance) {
    await supabase
      .from("hr_leave_balances")
      .update({ pending_days: Number(holdBalance.pending_days) + safeTotalDays })
      .eq("id", holdBalance.id);
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
