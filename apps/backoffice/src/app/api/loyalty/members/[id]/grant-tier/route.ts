import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth, getUserFromHeaders } from "@/lib/auth";

const BRAND_ID = "brand-celsius";

/**
 * POST /api/loyalty/members/[id]/grant-tier
 * Body: { tier_id: string | null }
 *
 * Grant a customer an invitation-only tier (Arba & Staff, Black Card),
 * or pass `tier_id: null` to revert them to auto-evaluation.
 *
 * Earned tiers (Member / Silver / Gold / Platinum) are intentionally
 * NOT grantable here — those come from quarterly spend via the
 * evaluate_member_tier RPC. Forcing one would be a comp/perk override
 * better expressed by directly editing tier_locked_until via SQL.
 *
 * After grant: the RPC's first branch keeps invitation-only tiers
 * untouched on every subsequent evaluation, so the assignment sticks
 * until an admin explicitly revokes (tier_id: null) or grants a
 * different invitation tier.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const caller = await getUserFromHeaders(request.headers);
  const callerLabel = caller?.name ?? caller?.id ?? "admin";

  const { id: memberId } = await params;
  const body = (await request.json().catch(() => ({}))) as { tier_id?: string | null };
  const tierId = body.tier_id ?? null;
  const nowIso = new Date().toISOString();

  // Verify the member exists for this brand.
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("member_brands")
    .select("member_id, current_tier_id")
    .eq("member_id", memberId)
    .eq("brand_id", BRAND_ID)
    .single<{ member_id: string; current_tier_id: string | null }>();

  if (memberErr || !member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Reset path — clear the grant so the RPC re-evaluates from
  // quarterly spend on its next call.
  if (tierId === null) {
    const { error } = await supabaseAdmin
      .from("member_brands")
      .update({
        current_tier_id: null,
        tier_locked_until: null,
        tier_evaluated_at: nowIso,
      })
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID);
    if (error) {
      return NextResponse.json(
        { error: `Reset failed: ${error.message}` },
        { status: 500 },
      );
    }
    console.warn(
      `[tier-grant] reset member=${memberId} (was tier=${member.current_tier_id ?? "—"}) by=${callerLabel}`,
    );
    return NextResponse.json({ ok: true, action: "reset", granted_by: callerLabel });
  }

  // Grant path — validate tier exists + is invitation-only.
  const { data: tier, error: tierErr } = await supabaseAdmin
    .from("tiers")
    .select("id, name, slug, is_active, invitation_only")
    .eq("id", tierId)
    .maybeSingle<{
      id: string;
      name: string;
      slug: string;
      is_active: boolean;
      invitation_only: boolean;
    }>();

  if (tierErr || !tier) {
    return NextResponse.json({ error: "Tier not found" }, { status: 404 });
  }
  if (!tier.is_active) {
    return NextResponse.json(
      { error: `Tier "${tier.name}" is inactive` },
      { status: 400 },
    );
  }
  if (!tier.invitation_only) {
    return NextResponse.json(
      {
        error:
          "Only invitation-only tiers can be granted manually. Earned tiers (Member/Silver/Gold/Platinum) come from quarterly spend.",
      },
      { status: 400 },
    );
  }

  // Apply the grant. Lock-until is cleared because the RPC's first
  // branch always preserves invitation tiers — a lock would be
  // redundant and confusing in the UI.
  const { error: updErr } = await supabaseAdmin
    .from("member_brands")
    .update({
      current_tier_id: tier.id,
      tier_locked_until: null,
      tier_evaluated_at: nowIso,
    })
    .eq("member_id", memberId)
    .eq("brand_id", BRAND_ID);

  if (updErr) {
    return NextResponse.json(
      { error: `Grant failed: ${updErr.message}` },
      { status: 500 },
    );
  }

  console.warn(
    `[tier-grant] member=${memberId} → tier=${tier.slug} by=${callerLabel}`,
  );

  return NextResponse.json({
    ok: true,
    action: "granted",
    tier_id: tier.id,
    tier_slug: tier.slug,
    tier_name: tier.name,
    granted_by: callerLabel,
  });
}
