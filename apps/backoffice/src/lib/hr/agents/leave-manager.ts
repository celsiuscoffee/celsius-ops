import { hrSupabaseAdmin } from "../supabase";
import { prisma } from "@/lib/prisma";

type LeaveDecision = {
  // "review" = checks passed, recommend approval; "escalate" = a check failed.
  // Neither auto-approves — every leave request now waits for a manager.
  decision: "review" | "escalate";
  reason: string;
};

const MIN_STAFF_PER_DAY = 2;

/**
 * AI Leave Manager — ADVISORY ONLY (and currently unused; the live submit path
 * is apps/staff's leave-manager).
 *
 * Owner rule 2026-08-21: leave NO LONGER auto-approves — every request must be
 * approved by a manager. This kept in sync with the staff copy so it can never
 * become a back-door auto-approve if wired up later.
 * Rules:
 * 1. Balance check — does employee have enough days?
 * 2. Coverage check — will outlet still have minimum staff?
 * 3. Blackout check — is it a restricted period?
 */
export async function processLeaveRequest(requestId: string): Promise<LeaveDecision> {
  // 1. Get the leave request
  const { data: request, error } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (error || !request) {
    return { decision: "escalate", reason: "Leave request not found" };
  }

  const { user_id, leave_type, start_date, end_date, total_days } = request;

  // 2. Balance check
  const currentYear = new Date().getFullYear();
  const { data: balance } = await hrSupabaseAdmin
    .from("hr_leave_balances")
    .select("*")
    .eq("user_id", user_id)
    .eq("year", currentYear)
    .eq("leave_type", leave_type)
    .maybeSingle();

  if (!balance) {
    return { decision: "escalate", reason: `No ${leave_type} leave balance found for this year. Set up leave balances first.` };
  }

  const available = Number(balance.entitled_days) + Number(balance.carried_forward) - Number(balance.used_days) - Number(balance.pending_days);
  if (total_days > available) {
    return {
      decision: "escalate",
      reason: `Insufficient ${leave_type} balance. Requested: ${total_days} days, Available: ${available} days.`,
    };
  }

  // 3. Coverage check — will the outlet have enough staff?
  const user = await prisma.user.findUnique({
    where: { id: user_id },
    select: { outletId: true, outlet: { select: { name: true } } },
  });

  if (user?.outletId) {
    // Count other approved leaves overlapping the same dates at this outlet
    const { data: overlapping } = await hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("user_id")
      .neq("id", requestId)
      .neq("user_id", user_id)
      .in("status", ["approved", "ai_approved", "pending"])
      .lte("start_date", end_date)
      .gte("end_date", start_date);

    // Get overlapping user IDs that belong to the same outlet
    const overlappingUserIds = (overlapping || []).map((l: { user_id: string }) => l.user_id);

    // Count total active staff at this outlet
    const outletStaff = await prisma.user.count({
      where: {
        status: "ACTIVE",
        OR: [
          { outletId: user.outletId },
          { outletIds: { has: user.outletId } },
        ],
        role: { in: ["STAFF", "MANAGER"] },
      },
    });

    // Staff that would be on leave (including this request)
    const sameOutletLeaves = overlappingUserIds.length; // simplified — could cross-check outlet
    const remainingStaff = outletStaff - sameOutletLeaves - 1; // -1 for this person

    if (remainingStaff < MIN_STAFF_PER_DAY) {
      return {
        decision: "escalate",
        reason: `Insufficient coverage at ${user.outlet?.name || "outlet"}. Only ${remainingStaff} staff remaining (min: ${MIN_STAFF_PER_DAY}).`,
      };
    }
  }

  // 4. All checks passed — RECOMMEND approval only. Never flip status to
  // "ai_approved" and never touch pending_days: the request stays "pending"
  // for a manager to approve (owner 2026-08-21).
  await hrSupabaseAdmin
    .from("hr_leave_requests")
    .update({
      ai_decision: "recommend_approve",
      ai_reason: `Recommend approve — balance OK (${available - total_days} days would remain), coverage OK. Awaiting manager approval.`,
      ai_processed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return {
    decision: "review",
    reason: `Recommend approve — balance OK (${available - total_days} days remaining), coverage OK. Pending manager approval.`,
  };
}
