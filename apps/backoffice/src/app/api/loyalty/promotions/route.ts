import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/promotions?brand_id=brand-celsius
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    const { data, error } = await supabaseAdmin
      .from('promotions')
      .select('*')
      .eq('brand_id', brandId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/loyalty/promotions — create a promotion
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    if (!body.name || !body.trigger_type || !body.discount_type) {
      return NextResponse.json(
        { error: 'name, trigger_type, discount_type required' },
        { status: 400 }
      );
    }

    const id = body.id || `promo-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('promotions')
      .insert({
        id,
        brand_id: body.brand_id || 'brand-celsius',
        name: body.name,
        description: body.description ?? null,
        trigger_type: body.trigger_type,
        promo_code: body.promo_code ?? null,
        tier_id: body.tier_id ?? null,
        discount_type: body.discount_type,
        discount_value: body.discount_value ?? null,
        max_discount_value: body.max_discount_value ?? null,
        applicable_products: body.applicable_products ?? [],
        applicable_categories: body.applicable_categories ?? [],
        applicable_tags: body.applicable_tags ?? [],
        outlet_ids: body.outlet_ids ?? [],
        bogo_buy_qty: body.bogo_buy_qty ?? null,
        bogo_free_qty: body.bogo_free_qty ?? null,
        free_product_ids: body.free_product_ids ?? [],
        free_product_name: body.free_product_name ?? null,
        combo_product_ids: body.combo_product_ids ?? [],
        combo_price: body.combo_price ?? null,
        override_price: body.override_price ?? null,
        min_order_value: body.min_order_value ?? null,
        valid_from: body.valid_from ?? null,
        valid_until: body.valid_until ?? null,
        day_of_week: body.day_of_week ?? [],
        time_start: body.time_start ?? null,
        time_end: body.time_end ?? null,
        max_uses_total: body.max_uses_total ?? null,
        max_uses_per_member: body.max_uses_per_member ?? null,
        stackable: body.stackable ?? false,
        is_active: body.is_active ?? true,
        priority: body.priority ?? 0,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/loyalty/promotions — update a promotion
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const allowed = [
      'name', 'description',
      'trigger_type', 'promo_code', 'tier_id',
      'discount_type', 'discount_value', 'max_discount_value',
      'applicable_products', 'applicable_categories', 'applicable_tags', 'outlet_ids',
      'bogo_buy_qty', 'bogo_free_qty', 'free_product_ids', 'free_product_name',
      'combo_product_ids', 'combo_price', 'override_price',
      'min_order_value',
      'valid_from', 'valid_until',
      'day_of_week', 'time_start', 'time_end',
      'max_uses_total', 'max_uses_per_member',
      'stackable', 'is_active', 'priority',
    ];

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (fields[k] !== undefined) updates[k] = fields[k];

    const { data, error } = await supabaseAdmin
      .from('promotions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/loyalty/promotions?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { error } = await supabaseAdmin.from('promotions').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
