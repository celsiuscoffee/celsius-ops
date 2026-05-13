// GET /api/loyalty/me/streak/chests
//
// Returns the member's chest state for the Challenges tab:
//   - claimable: every chest with claimed_at = NULL and not expired
//   - recent:    the last 10 claimed chests (trophy shelf)
//   - tier_ladder: the full chest tier ladder so the UI can render
//                  "what's next" without a second roundtrip
//
// The tier ladder is static config (admin-edited rarely) so the UI
// can cache it; we ship it inline anyway to keep one endpoint = one
// render.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const supabase = getSupabaseAdmin();
  const memberId = r.member.memberId;
  const now = new Date().toISOString();

  const [
    { data: claimable },
    { data: recent },
    { data: tiers },
    { data: voucherTpls },
  ] = await Promise.all([
    supabase
      .from("streak_weekly_chests")
      .select("id, week_start, streak_at_qualify, tier_floor, qualified_at, expires_at")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .is("claimed_at", null)
      .gt("expires_at", now)
      .order("week_start", { ascending: false }),
    supabase
      .from("streak_weekly_chests")
      .select("id, week_start, streak_at_qualify, tier_floor, claimed_at, claim_outcome")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .not("claimed_at", "is", null)
      .order("claimed_at", { ascending: false })
      .limit(10),
    supabase
      .from("streak_chest_tiers")
      .select("streak_floor, label, description, bonus_beans, voucher_template_id, emoji")
      .eq("brand_id", BRAND_ID)
      .order("streak_floor", { ascending: true }),
    supabase
      .from("voucher_templates")
      .select("id, title")
      .eq("brand_id", BRAND_ID),
  ]);

  // Hydrate tier rows with voucher_title so the UI doesn't have to
  // join on every render.
  const voucherTitleById = new Map<string, string>(
    (voucherTpls ?? []).map((v) => [v.id as string, v.title as string]),
  );
  const ladder = (tiers ?? []).map((t) => ({
    ...t,
    voucher_title: t.voucher_template_id
      ? voucherTitleById.get(t.voucher_template_id as string) ?? null
      : null,
  }));

  return NextResponse.json({
    claimable: claimable ?? [],
    recent: recent ?? [],
    tier_ladder: ladder,
  });
}
