import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/tiers?brand_id=brand-celsius
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    const { data, error } = await supabaseAdmin
      .from('tiers')
      .select('*')
      .eq('brand_id', brandId)
      .order('sort_order', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/loyalty/tiers — update tier settings
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const allowedKeys = [
      'name', 'min_visits', 'period_days', 'color', 'icon',
      'benefits', 'multiplier', 'sort_order', 'is_active',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (fields[key] !== undefined) updates[key] = fields[key];
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('tiers')
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
