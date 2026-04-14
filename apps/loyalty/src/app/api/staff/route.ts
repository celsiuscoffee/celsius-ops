import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/staff — fetch staff with loyalty access (single DB)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    // Fetch active users with loyalty in appAccess
    const { data: users, error } = await supabaseAdmin
      .from('User')
      .select('id, name, email, phone, role, outletId, outletIds, appAccess, status, createdAt')
      .eq('status', 'ACTIVE')
      .contains('appAccess', ['loyalty'])
      .order('name');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch outlets to resolve names
    const { data: outlets } = await supabaseAdmin
      .from('Outlet')
      .select('id, name, loyaltyOutletId')
      .eq('status', 'ACTIVE');

    const outletMap = new Map((outlets || []).map((o: { id: string; name: string; loyaltyOutletId: string | null }) => [o.id, o]));

    const mapped = (users || []).map((u: Record<string, unknown>) => {
      const outlet = outletMap.get(u.outletId as string) as { id: string; name: string; loyaltyOutletId: string | null } | undefined;
      const outletIds = (u.outletIds as string[]) || [];
      return {
        id: u.id,
        name: u.name,
        email: u.email || '',
        role: (u.role as string)?.toLowerCase() || 'staff',
        outlet_id: outlet?.loyaltyOutletId || null,
        outlet_ids: outletIds
          .map((id: string) => {
            const o = outletMap.get(id) as { loyaltyOutletId: string | null } | undefined;
            return o?.loyaltyOutletId;
          })
          .filter(Boolean),
        outlet_name: outlet?.name || '',
        is_active: u.status === 'ACTIVE',
        has_pin: false, // Never expose PIN info
        created_at: u.createdAt,
      };
    });

    return NextResponse.json(mapped);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
