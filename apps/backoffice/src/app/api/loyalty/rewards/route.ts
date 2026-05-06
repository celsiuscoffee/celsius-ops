import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/rewards?brand_id=brand-celsius
//   &active_only=true   — for storefront / pickup app (defaults to false for admin)
//   &fulfillment=pickup — channel filter
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const activeOnly = searchParams.get('active_only') === 'true';
    const fulfillment = searchParams.get('fulfillment');

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from('rewards')
      .select('id, brand_id, name, description, points_required, category, stock, is_active, image_url, reward_type, validity_days, max_redemptions_per_member, auto_issue, linked_promotion_id, distribution_methods, discount_type, discount_value, max_discount_value, override_price, combo_product_ids, combo_price, min_order_value, applicable_products, applicable_categories, applicable_tags, free_product_ids, free_product_name, bogo_buy_qty, bogo_free_qty, fulfillment_type')
      .eq('brand_id', brandId)
      .order('points_required', { ascending: true });

    if (activeOnly) query = query.eq('is_active', true);
    if (fulfillment) query = query.contains('fulfillment_type', [fulfillment]);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const response = NextResponse.json(data);
    // Admin page calls this without active_only — keep it fresh so toggles
    // and edits appear immediately. The storefront route on the loyalty
    // app does its own caching via active_only=true + CDN.
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/rewards — create a reward
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const {
      name,
      description,
      points_required,
      category,
      stock,
      brand_id,
      reward_type,
      image_url,
      validity_days,
      max_redemptions_per_member,
      auto_issue,
      linked_promotion_id,
      is_active,
      distribution_methods,
    } = body;

    // points_required CAN be 0 (birthday rewards, tier perks). Treat
    // missing/non-numeric as invalid, but accept 0.
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (typeof points_required !== 'number' || points_required < 0) {
      return NextResponse.json(
        { error: 'points_required must be a non-negative number' },
        { status: 400 }
      );
    }

    const id = `reward-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('rewards')
      .insert({
        id,
        brand_id: brand_id || 'brand-celsius',
        name,
        description: description ?? null,
        points_required,
        category: category || 'drink',
        stock: stock ?? null,
        reward_type: reward_type || 'standard',
        image_url: image_url ?? null,
        validity_days: validity_days ?? null,
        max_redemptions_per_member: max_redemptions_per_member ?? null,
        auto_issue: auto_issue ?? false,
        linked_promotion_id: linked_promotion_id ?? null,
        is_active: is_active ?? true,
        distribution_methods: Array.isArray(distribution_methods) ? distribution_methods : [],
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
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
      // Optional link to promotion engine (preferred for discount mechanics).
      'linked_promotion_id',
      // Structured distribution methods (preferred over reward_type+auto_issue).
      'distribution_methods',
      // Legacy inline discount fields — still editable for back-compat,
      // but new rewards should use linked_promotion_id instead.
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
