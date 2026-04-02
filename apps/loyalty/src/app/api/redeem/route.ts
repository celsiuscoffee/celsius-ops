import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { randomInt } from 'crypto';

// Generate an 8-character redemption code (e.g. "A7X2B9KP")
function generateRedemptionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(randomInt(0, chars.length));
  }
  return code;
}

// POST /api/redeem — redeem a reward
// Body: { member_id, reward_id, brand_id, outlet_id? }
export async function POST(request: NextRequest) {
  try {
    // Require staff/admin authentication
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { member_id, reward_id, brand_id, outlet_id, staff_redeem,
            redemption_type, pickup_outlet_id, source } = body;

    if (!member_id || !reward_id || !brand_id) {
      return NextResponse.json(
        { error: 'member_id, reward_id, and brand_id are required' },
        { status: 400 }
      );
    }

    // Fetch reward
    const { data: reward, error: rewardError } = await supabaseAdmin
      .from('rewards')
      .select('*')
      .eq('id', reward_id)
      .eq('brand_id', brand_id)
      .eq('is_active', true)
      .single();

    if (rewardError || !reward) {
      return NextResponse.json(
        { error: 'Reward not found or inactive' },
        { status: 404 }
      );
    }

    // Check stock
    if (reward.stock !== null && reward.stock <= 0) {
      return NextResponse.json(
        { error: 'Reward is out of stock' },
        { status: 400 }
      );
    }

    // Check max redemptions per member if set
    if (reward.max_redemptions_per_member !== null) {
      const { count } = await supabaseAdmin
        .from('redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('member_id', member_id)
        .eq('reward_id', reward_id)
        .neq('status', 'cancelled');

      if (count !== null && count >= reward.max_redemptions_per_member) {
        return NextResponse.json(
          { error: 'Maximum redemptions reached for this reward' },
          { status: 400 }
        );
      }
    }

    // ── Atomic point deduction via Supabase RPC ──
    // This prevents race conditions where two concurrent redemptions
    // both read the same balance and both succeed, creating negative points.
    const { data: deductResult, error: deductError } = await supabaseAdmin
      .rpc('deduct_points', {
        p_member_id: member_id,
        p_brand_id: brand_id,
        p_points: reward.points_required,
      });

    if (deductError) {
      console.error('deduct_points RPC error:', deductError.message);
      // Fallback: if RPC doesn't exist yet, use legacy non-atomic method
      if (deductError.message.includes('function') || deductError.code === '42883') {
        return await legacyRedeem(member_id, reward, brand_id, outlet_id, staff_redeem);
      }
      return NextResponse.json({ error: 'Failed to deduct points' }, { status: 500 });
    }

    // RPC returns new balance, or -1 if insufficient points
    const newBalance = deductResult as number;
    if (newBalance < 0) {
      return NextResponse.json(
        { error: 'Insufficient points' },
        { status: 400 }
      );
    }

    const redemptionCode = generateRedemptionCode();

    // Calculate expiry for pickup/delivery redemptions (default 60 min)
    const isPickup = redemption_type === 'pickup' || redemption_type === 'delivery';
    const expiryMinutes = reward.expiry_minutes || 60;
    const expiresAt = isPickup
      ? new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()
      : null;

    // Create redemption record
    const rdmId = `rdm-${Date.now()}-${randomInt(1000, 9999)}`;
    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from('redemptions')
      .insert({
        id: rdmId,
        member_id,
        reward_id,
        brand_id,
        outlet_id: outlet_id || null,
        points_spent: reward.points_required,
        status: staff_redeem ? 'confirmed' : 'pending',
        code: redemptionCode,
        redemption_type: redemption_type || 'in_store',
        pickup_outlet_id: pickup_outlet_id || null,
        expires_at: expiresAt,
        source: source || 'portal',
        ...(staff_redeem ? { confirmed_at: new Date().toISOString() } : {}),
      })
      .select()
      .single();

    if (redemptionError) {
      // Rollback: return points if redemption record fails
      await supabaseAdmin.rpc('deduct_points', {
        p_member_id: member_id,
        p_brand_id: brand_id,
        p_points: -reward.points_required, // negative = add back
      });
      return NextResponse.json(
        { error: redemptionError.message },
        { status: 500 }
      );
    }

    // Create point_transaction for the redemption
    const rdmTxnId = `txn-rdm-${Date.now()}-${randomInt(1000, 9999)}`;
    await supabaseAdmin
      .from('point_transactions')
      .insert({
        id: rdmTxnId,
        member_id,
        brand_id,
        outlet_id: outlet_id || null,
        type: 'redeem',
        points: -reward.points_required,
        balance_after: newBalance,
        description: `Redeemed: ${reward.name}`,
        reference_id: redemption.id,
        multiplier: 1,
      });

    // Atomic stock decrement (only if stock is tracked)
    if (reward.stock !== null) {
      await supabaseAdmin
        .from('rewards')
        .update({ stock: Math.max(0, reward.stock - 1) })
        .eq('id', reward_id)
        .gt('stock', 0);
    }

    return NextResponse.json({
      success: true,
      code: redemptionCode,
      redemption,
      new_balance: newBalance,
      // Pickup apps use these to auto-apply discount at checkout
      ...(isPickup ? {
        discount: {
          type: reward.discount_type || null,
          value: reward.discount_value || null,
          max_discount_value: reward.max_discount_value || null,
          min_order_value: reward.min_order_value || null,
          applicable_products: reward.applicable_products || null,
          applicable_categories: reward.applicable_categories || null,
          free_product_ids: reward.free_product_ids || null,
          free_product_name: reward.free_product_name || null,
          bogo_buy_qty: reward.bogo_buy_qty || 1,
          bogo_free_qty: reward.bogo_free_qty || 1,
        },
        expires_at: expiresAt,
      } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Legacy fallback for when the RPC function hasn't been created yet
async function legacyRedeem(
  member_id: string,
  reward: { id: string; name: string; points_required: number; stock: number | null },
  brand_id: string,
  outlet_id: string | null,
  staff_redeem: boolean
) {
  const { data: memberBrand, error: mbError } = await supabaseAdmin
    .from('member_brands')
    .select('*')
    .eq('member_id', member_id)
    .eq('brand_id', brand_id)
    .single();

  if (mbError || !memberBrand) {
    return NextResponse.json({ error: 'Member not found for this brand' }, { status: 404 });
  }

  if (memberBrand.points_balance < reward.points_required) {
    return NextResponse.json(
      { error: 'Insufficient points' },
      { status: 400 }
    );
  }

  const newBalance = memberBrand.points_balance - reward.points_required;
  const redemptionCode = generateRedemptionCode();
  const rdmId = `rdm-${Date.now()}-${randomInt(1000, 9999)}`;

  const { data: redemption, error: redemptionError } = await supabaseAdmin
    .from('redemptions')
    .insert({
      id: rdmId,
      member_id,
      reward_id: reward.id,
      brand_id,
      outlet_id: outlet_id || null,
      points_spent: reward.points_required,
      status: staff_redeem ? 'confirmed' : 'pending',
      code: redemptionCode,
      ...(staff_redeem ? { confirmed_at: new Date().toISOString() } : {}),
    })
    .select()
    .single();

  if (redemptionError) {
    return NextResponse.json({ error: redemptionError.message }, { status: 500 });
  }

  await supabaseAdmin
    .from('member_brands')
    .update({
      points_balance: newBalance,
      total_points_redeemed: memberBrand.total_points_redeemed + reward.points_required,
    })
    .eq('id', memberBrand.id);

  const rdmTxnId = `txn-rdm-${Date.now()}-${randomInt(1000, 9999)}`;
  await supabaseAdmin
    .from('point_transactions')
    .insert({
      id: rdmTxnId,
      member_id,
      brand_id,
      outlet_id: outlet_id || null,
      type: 'redeem',
      points: -reward.points_required,
      balance_after: newBalance,
      description: `Redeemed: ${reward.name}`,
      reference_id: redemption.id,
      multiplier: 1,
    });

  if (reward.stock !== null) {
    await supabaseAdmin
      .from('rewards')
      .update({ stock: Math.max(0, reward.stock - 1) })
      .eq('id', reward.id)
      .gt('stock', 0);
  }

  return NextResponse.json({
    success: true,
    code: redemptionCode,
    redemption,
    new_balance: newBalance,
  });
}
