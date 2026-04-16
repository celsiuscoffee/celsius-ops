import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/points-log?brand_id=brand-celsius&type=all&limit=500
// Fetch all point transactions with member info for admin view
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';
    const typeFilter = searchParams.get('type') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 1000);

    let query = supabaseAdmin
      .from('point_transactions')
      .select(`
        *,
        members:member_id ( name, phone )
      `)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (typeFilter !== 'all') {
      query = query.eq('type', typeFilter);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch outlet names by loyaltyOutletId and merge (PostgREST can't auto-join
    // to the `outlets` view after consolidation, so do it manually).
    const outletIds = Array.from(
      new Set((data || []).map((t) => t.outlet_id).filter(Boolean)),
    );

    let outletMap: Record<string, { id: string; name: string }> = {};
    if (outletIds.length > 0) {
      const { data: outletsData } = await supabaseAdmin
        .from('Outlet')
        .select('loyaltyOutletId, name')
        .in('loyaltyOutletId', outletIds);

      outletMap = (outletsData || []).reduce(
        (acc, o) => {
          if (o.loyaltyOutletId) acc[o.loyaltyOutletId] = { id: o.loyaltyOutletId, name: o.name };
          return acc;
        },
        {} as Record<string, { id: string; name: string }>,
      );
    }

    const merged = (data || []).map((t) => ({
      ...t,
      outlets: t.outlet_id ? outletMap[t.outlet_id] ?? null : null,
    }));

    return NextResponse.json(merged);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
