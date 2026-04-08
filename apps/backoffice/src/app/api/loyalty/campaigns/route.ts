import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/campaigns?brand_id=brand-celsius — fetch campaigns
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('brand_id', brandId)
      .order('start_date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/campaigns — create a new campaign
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { brand_id, name, type, target_segment, start_date, end_date, is_active, description, multiplier, bonus_points } = body;

    if (!brand_id || !name) {
      return NextResponse.json({ error: 'brand_id and name are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .insert({
        id: randomUUID(),
        brand_id,
        name,
        type: type || 'bonus',
        target_segment: target_segment || 'all',
        start_date: start_date ? start_date.split('T')[0] : new Date().toISOString().split('T')[0],
        end_date: end_date ? end_date.split('T')[0] : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        is_active: is_active ?? true,
        description: description || null,
        multiplier: multiplier || null,
        bonus_points: bonus_points || null,
        message: body.message || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/campaigns?id=<campaign_id> — update a campaign
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const body = await request.json();
    const { name, type, target_segment, start_date, end_date, is_active, description, multiplier, bonus_points, message } = body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (target_segment !== undefined) updates.target_segment = target_segment;
    if (start_date !== undefined) updates.start_date = typeof start_date === 'string' ? start_date.split('T')[0] : null;
    if (end_date !== undefined) updates.end_date = typeof end_date === 'string' ? end_date.split('T')[0] : null;
    if (is_active !== undefined) updates.is_active = is_active;
    if (description !== undefined) updates.description = description;
    if (multiplier !== undefined) updates.multiplier = multiplier;
    if (bonus_points !== undefined) updates.bonus_points = bonus_points;
    if (message !== undefined) updates.message = message;

    // Scope update to brand-celsius to prevent cross-brand edits
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(updates)
      .eq('id', id)
      .eq('brand_id', 'brand-celsius')
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/campaigns?id=<campaign_id> — delete a campaign
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Scope delete to brand-celsius
    const { error } = await supabaseAdmin
      .from('campaigns')
      .delete()
      .eq('id', id)
      .eq('brand_id', 'brand-celsius');

    if (error) {
      return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
