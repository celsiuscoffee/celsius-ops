// GET /api/loyalty/me/referral — get-or-create the caller's referral code
// and stats (total successful referrals).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { getOrCreateReferralCode } from "@/lib/loyalty/v2";

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const code = await getOrCreateReferralCode(r.member.memberId);
  if (!code) return NextResponse.json({ error: "Failed to mint code" }, { status: 500 });

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from("referral_codes")
    .select("total_referred")
    .eq("member_id", r.member.memberId)
    .single();

  // Also fetch attribution detail for the "your referrals" list.
  const { data: attrs } = await supabase
    .from("referral_attributions")
    .select("status, created_at, rewarded_at")
    .eq("referrer_id", r.member.memberId)
    .order("created_at", { ascending: false })
    .limit(20);

  // can_enter_code — whether the CALLER may still attribute someone
  // else's code as a referee. Mirrors attributeReferralOnSignup's
  // guards (no paid orders + never attributed before) so the client
  // can show/hide an "enter a friend's code" field without a doomed
  // submit. The attribute endpoint remains the source of truth.
  const [{ count: paidOrders }, { count: priorAttributions }] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("loyalty_id", r.member.memberId)
      .in("status", ["preparing", "ready", "completed"]),
    supabase
      .from("referral_attributions")
      .select("referee_id", { count: "exact", head: true })
      .eq("referee_id", r.member.memberId),
  ]);

  return NextResponse.json({
    code,
    total_referred: row?.total_referred ?? 0,
    pending: (attrs ?? []).filter((a) => a.status === "pending").length,
    rewarded: (attrs ?? []).filter((a) => a.status === "rewarded").length,
    recent: attrs ?? [],
    can_enter_code: (paidOrders ?? 0) === 0 && (priorAttributions ?? 0) === 0,
  });
}
