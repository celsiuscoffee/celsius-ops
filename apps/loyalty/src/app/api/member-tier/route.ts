import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { MemberTierStatus } from '@/types';

// GET /api/member-tier?member_id=X&brand_id=brand-celsius
// Public — called by member portal on load.
// Runs evaluate_member_tier RPC (updates tier in DB) and also fetches
// the active post-purchase issued reward if one exists.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('member_id');
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    if (!memberId) {
      return NextResponse.json({ error: 'member_id is required' }, { status: 400 });
    }

    // Run tier evaluation (updates member_brands.current_tier_id)
    const { data: tierData, error: tierError } = await supabaseAdmin
      .rpc('evaluate_member_tier', {
        p_member_id: memberId,
        p_brand_id: brandId,
      });

    if (tierError) {
      return NextResponse.json({ error: tierError.message }, { status: 500 });
    }

    const tier = tierData as MemberTierStatus;

    // Fetch active post-purchase issued reward (if any)
    const now = new Date().toISOString();
    const { data: issued } = await supabaseAdmin
      .from('issued_rewards')
      .select(`
        id,
        expires_at,
        reward:rewards(name, discount_value)
      `)
      .eq('member_id', memberId)
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .eq('rewards.reward_type', 'post_purchase')
      .gt('expires_at', now)
      .order('expires_at', { ascending: true })
      .limit(1);

    // Attach post-purchase coupon to response
    const activeCoupon = issued?.[0] ?? null;
    if (activeCoupon && activeCoupon.reward) {
      const reward = activeCoupon.reward as unknown as { name: string; discount_value: number | null };
      const expiresAt = new Date(activeCoupon.expires_at);
      const hoursRemaining = Math.max(
        0,
        Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))
      );
      tier.active_post_purchase = {
        id: activeCoupon.id,
        reward_name: reward.name,
        multiplier: reward.discount_value ?? 2,
        expires_at: activeCoupon.expires_at,
        hours_remaining: hoursRemaining,
      };
    } else {
      tier.active_post_purchase = null;
    }

    return NextResponse.json(tier);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
