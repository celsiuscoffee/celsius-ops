import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/brands — fetch all active brands (public-safe fields only)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('brands')
      .select('id, name, slug, logo_url, primary_color, secondary_color, currency')
      .eq('is_active', true)
      .order('name');

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

// PUT /api/brands — update brand settings
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const allowed: Record<string, unknown> = {};
    if (updates.points_per_rm !== undefined) allowed.points_per_rm = updates.points_per_rm;
    if (updates.points_expiry_enabled !== undefined) allowed.points_expiry_enabled = updates.points_expiry_enabled;
    if (updates.points_expiry_months !== undefined) allowed.points_expiry_months = updates.points_expiry_months;
    if (updates.daily_earning_limit !== undefined) allowed.daily_earning_limit = updates.daily_earning_limit;

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('brands')
      .update(allowed)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
