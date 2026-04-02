import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/staff — fetch staff users (requires admin auth, NEVER returns PINs)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const outletId = searchParams.get('outlet_id');

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from('staff_users')
      .select('id, brand_id, outlet_id, outlet_ids, name, email, role, is_active, created_at')
      .eq('brand_id', brandId);

    if (outletId) {
      query = query.eq('outlet_id', outletId);
    }

    query = query.order('name');

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/staff — delete a staff user (requires admin auth)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Scope delete to brand-celsius to prevent cross-brand deletion
    const { error } = await supabaseAdmin
      .from('staff_users')
      .delete()
      .eq('id', id)
      .eq('brand_id', 'brand-celsius');

    if (error) {
      return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
