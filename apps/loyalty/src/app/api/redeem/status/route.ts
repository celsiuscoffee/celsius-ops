import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/redeem/status?code=A7X2B9KP
 *
 * Public endpoint for pickup apps to check redemption status.
 * Returns reward discount details so the app can apply them.
 * No auth required — the code itself is the proof (8-char, ~1T combinations).
 */
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');

    if (!code || code.length < 6) {
      return NextResponse.json({ error: 'Valid redemption code is required' }, { status: 400 });
    }

    const { data: redemption, error } = await supabaseAdmin
      .from('redemptions')
      .select(`
        id, code, status, points_spent, created_at, confirmed_at,
        collected_at, expires_at, redemption_type, pickup_outlet_id, source,
        rewards:reward_id (
          id, name, description, image_url, points_required, category,
          discount_type, discount_value, max_discount_value, min_order_value,
          applicable_products, applicable_categories, free_product_ids,
          free_product_name, bogo_buy_qty, bogo_free_qty, fulfillment_type,
          expiry_minutes
        ),
        members:member_id ( id, name, phone )
      `)
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !redemption) {
      return NextResponse.json({ error: 'Invalid redemption code' }, { status: 404 });
    }

    // Check if expired
    if (
      redemption.status === 'pending' &&
      redemption.expires_at &&
      new Date(redemption.expires_at) < new Date()
    ) {
      // Auto-expire and refund points
      await supabaseAdmin
        .from('redemptions')
        .update({ status: 'expired' })
        .eq('id', redemption.id)
        .eq('status', 'pending');

      // Refund points
      await supabaseAdmin.rpc('deduct_points', {
        p_member_id: (redemption.members as unknown as { id: string })?.id,
        p_brand_id: redemption.id.startsWith('rdm-') ? 'brand-celsius' : 'brand-celsius',
        p_points: -redemption.points_spent, // negative = add back
      }).then(null, () => {
        // If RPC fails, log but don't block the status response
        console.error('Failed to refund points for expired redemption:', redemption.id);
      });

      return NextResponse.json({
        redemption: { ...redemption, status: 'expired' },
        valid: false,
        reason: 'Redemption has expired',
      });
    }

    const reward = redemption.rewards as unknown as Record<string, unknown> | null;

    return NextResponse.json({
      redemption: {
        code: redemption.code,
        status: redemption.status,
        points_spent: redemption.points_spent,
        created_at: redemption.created_at,
        confirmed_at: redemption.confirmed_at,
        collected_at: redemption.collected_at,
        expires_at: redemption.expires_at,
        redemption_type: redemption.redemption_type,
        pickup_outlet_id: redemption.pickup_outlet_id,
        source: redemption.source,
        reward: reward ? {
          id: reward.id,
          name: reward.name,
          description: reward.description,
          image_url: reward.image_url,
          category: reward.category,
        } : null,
        member_name: (redemption.members as unknown as { name: string } | null)?.name || null,
      },
      valid: redemption.status === 'pending' || redemption.status === 'confirmed',
      // Discount details for pickup app checkout
      ...(reward?.discount_type ? {
        discount: {
          type: reward.discount_type,
          value: reward.discount_value,
          max_discount_value: reward.max_discount_value,
          min_order_value: reward.min_order_value,
          applicable_products: reward.applicable_products,
          applicable_categories: reward.applicable_categories,
          free_product_ids: reward.free_product_ids,
          free_product_name: reward.free_product_name,
          bogo_buy_qty: reward.bogo_buy_qty ?? 1,
          bogo_free_qty: reward.bogo_free_qty ?? 1,
        },
      } : {}),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/redeem/status
 *
 * Pickup app marks a redemption as collected after customer picks up.
 * Body: { code, action: 'collect' }
 */
export async function POST(request: NextRequest) {
  try {
    const { code, action } = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    if (action !== 'collect') {
      return NextResponse.json({ error: 'Invalid action. Use "collect".' }, { status: 400 });
    }

    const { data: redemption, error } = await supabaseAdmin
      .from('redemptions')
      .select('id, status, expires_at')
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !redemption) {
      return NextResponse.json({ error: 'Invalid redemption code' }, { status: 404 });
    }

    if (redemption.status === 'collected') {
      return NextResponse.json({ error: 'Already collected' }, { status: 400 });
    }

    if (redemption.status === 'cancelled' || redemption.status === 'expired') {
      return NextResponse.json({ error: `Redemption is ${redemption.status}` }, { status: 400 });
    }

    // Check expiry
    if (redemption.expires_at && new Date(redemption.expires_at) < new Date()) {
      await supabaseAdmin
        .from('redemptions')
        .update({ status: 'expired' })
        .eq('id', redemption.id);
      return NextResponse.json({ error: 'Redemption has expired' }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('redemptions')
      .update({
        status: 'collected',
        collected_at: new Date().toISOString(),
      })
      .eq('id', redemption.id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update redemption' }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: 'collected' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
