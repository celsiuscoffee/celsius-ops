import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/rewards?brand_id=brand-celsius — fetch all active rewards for a brand
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    // Optional: filter by fulfillment channel (e.g. ?fulfillment=pickup)
    const fulfillment = searchParams.get('fulfillment');

    let query = supabaseAdmin
      .from('rewards')
      .select('id, brand_id, name, description, points_required, category, stock, is_active, image_url, reward_type, validity_days, max_redemptions_per_member, auto_issue, discount_type, discount_value, max_discount_value, override_price, combo_product_ids, combo_price, min_order_value, applicable_products, applicable_categories, applicable_tags, free_product_ids, free_product_name, bogo_buy_qty, bogo_free_qty, fulfillment_type')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('points_required', { ascending: true });

    // Filter rewards available for a specific channel
    if (fulfillment) {
      query = query.contains('fulfillment_type', [fulfillment]);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const response = NextResponse.json(data);
    // Rewards change infrequently — cache for 2 minutes at CDN
    response.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=30');
    return response;
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rewards — create a reward
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { name, description, points_required, category, stock, brand_id } = body;
    if (!name || !points_required) {
      return NextResponse.json({ error: 'name and points_required are required' }, { status: 400 });
    }
    const id = `reward-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('rewards')
      .insert({ id, brand_id: brand_id || 'brand-celsius', name, description, points_required, category: category || 'drink', stock: stock || null, is_active: true })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/rewards — update a reward
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Whitelist allowed fields
    const allowedKeys = [
      'name', 'description', 'points_required', 'category', 'stock',
      'is_active', 'image_url', 'reward_type', 'validity_days',
      'max_redemptions_per_member', 'auto_issue',
      // Pickup app discount fields
      'discount_type', 'discount_value', 'max_discount_value', 'override_price',
      'combo_product_ids', 'combo_price', 'min_order_value',
      'applicable_products', 'applicable_categories', 'applicable_tags',
      'free_product_ids', 'free_product_name', 'bogo_buy_qty', 'bogo_free_qty',
      'fulfillment_type',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (fields[key] !== undefined) updates[key] = fields[key];
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('rewards')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/rewards?id=xxx — delete a reward
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await supabaseAdmin.from('rewards').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
