import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/redemptions?member_id=xxx  — customer's own redemptions
// GET /api/redemptions?brand_id=xxx   — all redemptions for admin
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('member_id');
    const brandId = searchParams.get('brand_id');

    if (!memberId && !brandId) {
      return NextResponse.json(
        { error: 'member_id or brand_id is required' },
        { status: 400 }
      );
    }

    // Customer view: get redemptions for a specific member
    if (memberId) {
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;

      const { data, error } = await supabaseAdmin
        .from('redemptions')
        .select('*, rewards(name, category, image_url)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json(data || []);
    }

    // Admin view: get all redemptions for a brand (requires auth)
    if (brandId) {
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;
      const { data, error } = await supabaseAdmin
        .from('redemptions')
        .select('*, rewards(name, category), members(name, phone)')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json(data || []);
    }

    return NextResponse.json([]);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
