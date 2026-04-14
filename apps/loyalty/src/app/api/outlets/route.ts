import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/outlets?brand_id=brand-celsius — fetch all active outlets
export async function GET(request: NextRequest) {
  try {
    // Read from Prisma "Outlet" table (single DB, source of truth)
    const { data, error } = await supabaseAdmin
      .from('Outlet')
      .select('id, name, code, status, loyaltyOutletId')
      .eq('status', 'ACTIVE')
      .order('name');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Use loyaltyOutletId as the ID (for PIN verification compatibility)
    const mapped = (data || [])
      .filter((o: { loyaltyOutletId?: string }) => o.loyaltyOutletId)
      .map((o: { id: string; name: string; code?: string; loyaltyOutletId?: string }) => ({
        id: o.loyaltyOutletId,
        name: o.name,
        brand_id: 'brand-celsius',
        is_active: true,
      }));

    const response = NextResponse.json(mapped);
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
