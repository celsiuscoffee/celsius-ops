import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { randomInt } from 'crypto';

// POST /api/points/award — award points to a member
// Body: { member_id, brand_id, outlet_id, points, description, reference_id?, multiplier?, amount? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const {
      member_id,
      brand_id,
      outlet_id,
      points,
      amount,
      description,
      reference_id,
      multiplier = 1,
    } = body;

    if (!member_id || !brand_id || !outlet_id || !points || !description) {
      return NextResponse.json(
        { error: 'member_id, brand_id, outlet_id, points, and description are required' },
        { status: 400 }
      );
    }

    if (points <= 0 || !Number.isFinite(points)) {
      return NextResponse.json({ error: 'points must be a positive number' }, { status: 400 });
    }

    if (points > 10000) {
      return NextResponse.json(
        { error: 'points exceed maximum per transaction (10,000)' },
        { status: 400 }
      );
    }

    // ── 1. Resolve effective multiplier ──────────────────────────────────
    // Stack: caller multiplier × tier multiplier × post-purchase coupon multiplier

    // Idempotency — if this reference_id already produced an award, return it
    // instead of double-crediting. POS retries on network failures and would
    // otherwise grant 2× points for a single order.
    if (reference_id) {
      const { data: existing } = await supabaseAdmin
        .from('point_transactions')
        .select('*')
        .eq('reference_id', reference_id)
        .eq('brand_id', brand_id)
        .eq('type', 'earn')
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          success: true,
          transaction: existing,
          new_balance: existing.balance_after,
          duplicate: true,
        });
      }
    }

    const callerMultiplier = Math.min(Math.max(multiplier, 1), 10);

    // Fetch current tier multiplier
    const { data: memberBrandRaw } = await supabaseAdmin
      .from('member_brands')
      .select('*, tiers(multiplier)')
      .eq('member_id', member_id)
      .eq('brand_id', brand_id)
      .single();

    if (!memberBrandRaw) {
      return NextResponse.json({ error: 'Member not found for this brand' }, { status: 404 });
    }

    const tierMultiplier: number =
      (memberBrandRaw.tiers as { multiplier: number } | null)?.multiplier ?? 1.0;

    // Check for an active post-purchase coupon
    const now = new Date().toISOString();
    const { data: activeCoupons } = await supabaseAdmin
      .from('issued_rewards')
      .select('id, reward:rewards(discount_value, reward_type)')
      .eq('member_id', member_id)
      .eq('brand_id', brand_id)
      .eq('status', 'active')
      .gt('expires_at', now)
      .eq('rewards.reward_type', 'post_purchase')
      .limit(1);

    const activeCoupon = activeCoupons?.[0] ?? null;
    const couponReward = activeCoupon?.reward as unknown as { discount_value: number | null; reward_type: string } | null;
    const couponMultiplier: number = couponReward?.discount_value ?? 1.0;

    // Effective multiplier: caller × tier × coupon (capped at 20× to be safe)
    const effectiveMultiplier = Math.min(
      callerMultiplier * tierMultiplier * couponMultiplier,
      20
    );
    const effectivePoints = Math.round(points * effectiveMultiplier);

    // ── 2. Atomic balance update ─────────────────────────────────────────

    const newBalance = memberBrandRaw.points_balance + effectivePoints;

    const { data: updateData, error: updateError } = await supabaseAdmin
      .from('member_brands')
      .update({
        points_balance: newBalance,
        total_points_earned: memberBrandRaw.total_points_earned + effectivePoints,
        total_visits: memberBrandRaw.total_visits + 1,
        total_spent: memberBrandRaw.total_spent + (amount || points),
        last_visit_at: new Date().toISOString(),
      })
      .eq('id', memberBrandRaw.id)
      .eq('points_balance', memberBrandRaw.points_balance) // optimistic concurrency
      .select()
      .single();

    if (updateError || !updateData) {
      return NextResponse.json(
        { error: 'Balance changed concurrently, please retry' },
        { status: 409 }
      );
    }

    // Update preferred outlet
    if (outlet_id) {
      await supabaseAdmin
        .from('members')
        .update({ preferred_outlet_id: outlet_id })
        .eq('id', member_id);
    }

    // ── 3. Point transaction record ──────────────────────────────────────

    const txnId = `txn-${Date.now()}-${randomInt(1000, 9999)}`;
    const { data: transaction, error: txnError } = await supabaseAdmin
      .from('point_transactions')
      .insert({
        id: txnId,
        member_id,
        brand_id,
        outlet_id,
        type: 'earn',
        points: effectivePoints,
        balance_after: newBalance,
        description,
        reference_id: reference_id || null,
        multiplier: effectiveMultiplier,
      })
      .select()
      .single();

    if (txnError) {
      return NextResponse.json({ error: txnError.message }, { status: 500 });
    }

    // ── 4. Mark post-purchase coupon as used ─────────────────────────────

    if (activeCoupon) {
      await supabaseAdmin
        .from('issued_rewards')
        .update({ status: 'used' })
        .eq('id', activeCoupon.id);
    }

    // ── 5. Re-evaluate tier (fire-and-forget, non-blocking) ──────────────

    void Promise.resolve(
      supabaseAdmin.rpc('evaluate_member_tier', {
        p_member_id: member_id,
        p_brand_id: brand_id,
      })
    ).catch(() => {/* non-critical */});

    // ── 6. Auto-issue post-purchase coupon for the next visit ────────────

    await issuePostPurchaseCoupon(member_id, brand_id);

    return NextResponse.json({
      success: true,
      transaction,
      new_balance: newBalance,
      multiplier_applied: effectiveMultiplier,
      tier_multiplier: tierMultiplier,
      coupon_used: activeCoupon ? true : false,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Issue the configured post_purchase reward if the member doesn't already have one active.
async function issuePostPurchaseCoupon(memberId: string, brandId: string): Promise<void> {
  try {
    // Find the brand's post_purchase reward
    const { data: reward } = await supabaseAdmin
      .from('rewards')
      .select('id, validity_days')
      .eq('brand_id', brandId)
      .eq('reward_type', 'post_purchase')
      .eq('auto_issue', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!reward) return;

    // Check if member already has an active one from a previous visit
    const now = new Date().toISOString();
    const { count } = await supabaseAdmin
      .from('issued_rewards')
      .select('*', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('reward_id', reward.id)
      .eq('status', 'active')
      .gt('expires_at', now);

    if ((count ?? 0) > 0) return; // already has one

    const validityDays = reward.validity_days ?? 7;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
    const issuedId = `ir-pp-${Date.now()}-${randomInt(1000, 9999)}`;

    await supabaseAdmin.from('issued_rewards').insert({
      id: issuedId,
      member_id: memberId,
      reward_id: reward.id,
      brand_id: brandId,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      status: 'active',
      code: issuedId,
      year: new Date().getFullYear(),
    });
  } catch {
    // Non-critical — don't fail the main award if coupon issuance errors
  }
}
