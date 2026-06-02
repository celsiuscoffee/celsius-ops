// POST /api/loyalty/me/rewards/[rewardId]/redeem
//
// Spend Points to add a points-shop reward to the customer's wallet.
// Atomically deducts points_required from the member's balance and
// inserts an issued_rewards row with all the display + discount metadata
// copied off the reward, so the new voucher behaves identically to one
// issued by a mission completion or admin claim.
//
// 200 → { voucher, newBalance, pointsSpent }
// 402 → { error } when the member doesn't have enough Points
// 404 → { error } when the reward doesn't exist / isn't active
// 401 → standard auth failure from resolveMember

import { NextRequest, NextResponse } from "next/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { redeemPointsShopReward } from "@/lib/loyalty/v2";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ rewardId: string }> },
) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const { rewardId } = await ctx.params;
  if (!rewardId) {
    return NextResponse.json({ error: "rewardId required" }, { status: 400 });
  }

  const result = await redeemPointsShopReward({
    memberId: r.member.memberId,
    rewardId,
  });

  if (!result.ok) {
    if (result.reason === "reward_not_found") {
      return NextResponse.json({ error: "Reward not available" }, { status: 404 });
    }
    if (result.reason === "insufficient_beans") {
      return NextResponse.json({ error: "Not enough Points" }, { status: 402 });
    }
    return NextResponse.json({ error: "Could not redeem" }, { status: 500 });
  }

  return NextResponse.json({
    voucher: result.voucher,
    newBalance: result.newBalance,
    pointsSpent: result.pointsSpent,
  });
}
