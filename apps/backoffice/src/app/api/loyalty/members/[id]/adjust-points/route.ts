import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth, getUserFromHeaders, hasModulePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const BRAND_ID = "brand-celsius";

/**
 * POST /api/loyalty/members/[id]/adjust-points
 * Body: { delta: number, reason: string }
 *
 * Manual point adjustment for a member — used for service recovery,
 * data correction, or bonus awards. Writes the adjustment atomically
 * to point_transactions (with type='adjust' and the supplied reason
 * in description) and updates the member's points_balance.
 *
 * `delta` is signed: positive = credit, negative = debit. Adjustments
 * that would push the balance below zero are clamped at zero so the
 * audit trail still records what was attempted (delta as written, not
 * "what we ended up applying").
 *
 * Admin-only. Audit fields: who made the change is captured in the
 * transaction's `description` so it shows up in the points-log view.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (!(await hasModulePermission(auth.user, "loyalty:manual-grant", prisma))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const caller = await getUserFromHeaders(request.headers);
  const callerLabel = caller?.name ?? caller?.id ?? "admin";

  const { id: memberId } = await params;
  const body = (await request.json()) as { delta?: number; reason?: string };
  const delta = Math.round(Number(body.delta));
  const reason = (body.reason ?? "").trim();

  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json(
      { error: "delta must be a non-zero integer" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "reason is required (audit trail)" },
      { status: 400 },
    );
  }
  if (Math.abs(delta) > 1_000_000) {
    return NextResponse.json(
      { error: "delta exceeds 1,000,000 — split into multiple adjustments if intentional" },
      { status: 400 },
    );
  }

  // Fetch current balance
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("member_brands")
    .select("points_balance, total_points_earned")
    .eq("member_id", memberId)
    .eq("brand_id", BRAND_ID)
    .single<{ points_balance: number; total_points_earned: number }>();

  if (memberErr || !member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const currentBalance = member.points_balance;
  const newBalance = Math.max(0, currentBalance + delta);
  const appliedDelta = newBalance - currentBalance; // can differ from `delta` if clamped

  // Update balance + total_points_earned (only on credits)
  const { error: updErr } = await supabaseAdmin
    .from("member_brands")
    .update({
      points_balance: newBalance,
      total_points_earned:
        appliedDelta > 0
          ? member.total_points_earned + appliedDelta
          : member.total_points_earned,
    })
    .eq("member_id", memberId)
    .eq("brand_id", BRAND_ID)
    .eq("points_balance", currentBalance); // optimistic concurrency

  if (updErr) {
    return NextResponse.json(
      { error: `Update failed: ${updErr.message}` },
      { status: 500 },
    );
  }

  // Audit row in point_transactions
  const txnId = `txn-adjust-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}`;
  const { error: txnErr } = await supabaseAdmin.from("point_transactions").insert({
    id: txnId,
    member_id: memberId,
    brand_id: BRAND_ID,
    type: "adjust",
    points: appliedDelta,
    balance_after: newBalance,
    description: `${appliedDelta >= 0 ? "+" : ""}${appliedDelta} by ${callerLabel}: ${reason}`,
    multiplier: 1,
  });

  if (txnErr) {
    // Balance is already updated; the audit row failing is bad but
    // recoverable. Surface the error so the caller knows to log it.
    console.error(
      `[adjust-points] balance updated but txn-log insert failed for member=${memberId} delta=${appliedDelta}:`,
      txnErr.message,
    );
    return NextResponse.json(
      {
        ok: true,
        newBalance,
        appliedDelta,
        warning: "Balance updated but audit-log row failed to insert — check point_transactions",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    newBalance,
    appliedDelta,
    requestedDelta: delta,
  });
}
