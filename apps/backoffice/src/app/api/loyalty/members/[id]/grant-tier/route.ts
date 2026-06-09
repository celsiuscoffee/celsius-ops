import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth, getUserFromHeaders } from "@/lib/auth";

const BRAND_ID = "brand-celsius";

/**
 * POST /api/loyalty/members/[id]/grant-tier
 * Body: { tier_id: string | null }
 *
 * Grant a customer any active tier, or pass `tier_id: null` to revert
 * them to auto-evaluation.
 *
 * How the grant persists depends on the tier kind — driven by the
 * evaluate_member_tier RPC that runs on every purchase:
 *
 *  • Invitation-only tiers (Staff, Black Card): the RPC's first branch
 *    never auto-overwrites an invitation tier, so we leave
 *    tier_locked_until null and the grant sticks until an admin
 *    explicitly resets (tier_id: null) or grants a different tier.
 *
 *  • Earned tiers (Member / Silver / Gold / Platinum): the RPC
 *    re-evaluates these from quarterly spend. We pin the grant by
 *    setting tier_locked_until to the current quarter end — the RPC
 *    honours an active lock and won't demote mid-quarter (only spend
 *    upgrades land). When the quarter rolls over the lock expires and
 *    the member re-evaluates from real spend, same as a naturally
 *    earned tier.
 */

/** First instant of the next calendar quarter (UTC), matching the
 *  RPC's `date_trunc('quarter', now()) + interval '3 months'`. */
function currentQuarterEndIso(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3); // 0..3
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1)).toISOString();
}
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

  // Grant path — validate the tier exists and is active.
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

  // Apply the grant. Invitation tiers need no lock (the RPC preserves
  // them); earned tiers are pinned to the quarter end so the RPC's
  // lock-honouring branch holds them until the quarter rolls over.
  const lockedUntil = tier.invitation_only ? null : currentQuarterEndIso();
  const { error: updErr } = await supabaseAdmin
    .from("member_brands")
    .update({
      current_tier_id: tier.id,
      tier_locked_until: lockedUntil,
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
    `[tier-grant] member=${memberId} → tier=${tier.slug} lock=${lockedUntil ?? "none"} by=${callerLabel}`,
  );

  return NextResponse.json({
    ok: true,
    action: "granted",
    locked_until: lockedUntil,
    tier_id: tier.id,
    tier_slug: tier.slug,
    tier_name: tier.name,
    granted_by: callerLabel,
  });
}
