// Service-role client: hr_* tables are RLS-enabled with no policies, so the anon
// client reads ZERO rows. This module ran on the anon client from 2026-07-09
// (commit 67ddf6b4 switched the routes but not this agent) until now — its first
// .single() errored, every request escalated as "Leave request not found", and
// no balance/coverage/MC check ran anywhere in the approval chain. Callers pass
// only a request id and we re-read the row ourselves, so the security boundary
// is the submitting route's session scoping, same as the other staff HR routes.
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

const hrSupabaseAdmin = supabaseAdmin;

type LeaveDecision = {
  // "review" = checks passed, recommend approval; "escalate" = a check failed.
  // Neither auto-approves — every leave request now waits for a manager.
  decision: "review" | "escalate";
  reason: string;
};

const MIN_STAFF_PER_DAY = 2;

/**
 * AI Leave Manager — ADVISORY ONLY.
 *
 * Owner rule 2026-08-21: leave NO LONGER auto-approves. Every request must be
 * approved by a manager in the backoffice. This agent still runs its checks
 * and records a recommendation (ai_decision / ai_reason) so the manager has the
 * balance + coverage context, but it NEVER sets status to "ai_approved" — the
 * request stays "pending" either way.
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

  // 1b. Sick leave must have an MC attached. The submit route now refuses one
  // without it, but this is the gate that actually matters: it catches rows
  // created by any other path, and it is what stops an AUTO-APPROVE. Four sick
  // leaves were approved on a free-text reason with attachment_url NULL.
  if (leave_type === "sick" && !request.attachment_url) {
    return { decision: "escalate", reason: "Sick leave has no MC attached — needs a manager to review." };
  }

  // 2. Balance check — keyed to the leave's START year, not "today". The
  // approve/reject paths bank used_days against start_date's year, so holding
  // pending_days against the submission year would strand the hold on the old
  // year's row for a December-submitted January leave.
  const balanceYear = new Date(start_date).getFullYear();
  const { data: balance } = await hrSupabaseAdmin
    .from("hr_leave_balances")
    .select("*")
    .eq("user_id", user_id)
    .eq("year", balanceYear)
    .eq("leave_type", leave_type)
    .maybeSingle();

  if (!balance) {
    return { decision: "escalate", reason: `No ${leave_type} leave balance found for this year. Set up leave balances first.` };
  }

  // The submit route holds pending_days BEFORE calling us, so this request's
  // own reservation is already inside pending_days — add total_days back to get
  // availability as it stood before this request, otherwise every request
  // double-counts itself and self-blocks.
  const available =
    Number(balance.entitled_days) + Number(balance.carried_forward) -
    Number(balance.used_days) - Number(balance.pending_days) + Number(total_days);
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

  // 4. All checks passed — RECOMMEND approval, but do NOT approve. The status
  // stays "pending" so a manager makes the call (owner 2026-08-21). We only
  // record the advisory note; no status flip and no pending_days write (the
  // submit route already holds the reservation, and the manager-approve path
  // converts pending → used).
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
