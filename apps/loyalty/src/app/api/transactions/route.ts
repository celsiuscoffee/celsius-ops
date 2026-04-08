import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/transactions?member_id=member-1&brand_id=brand-celsius&limit=50
// Fetch point transactions for a member (paginated)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('member_id');
    const brandId = searchParams.get('brand_id');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
    const page = parseInt(searchParams.get('page') ?? '0');

    if (!memberId || !brandId) {
      return NextResponse.json(
        { error: 'member_id and brand_id query parameters are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('point_transactions')
      .select('*')
      .eq('member_id', memberId)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);

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
