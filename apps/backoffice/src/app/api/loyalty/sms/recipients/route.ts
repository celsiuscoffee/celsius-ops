import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/sms/recipients?brand_id=brand-celsius&message=<encoded_msg>
// Returns member IDs who received a specific SMS message
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';
    const message = searchParams.get('message');

    if (!message) {
      return NextResponse.json({ error: 'message parameter is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('sms_logs')
      .select('member_id')
      .eq('brand_id', brandId)
      .eq('message', message)
      .not('member_id', 'is', null)
      .limit(50000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Deduplicate member IDs
    const memberIds = [...new Set((data || []).map((r) => r.member_id).filter(Boolean))];

    return NextResponse.json({ member_ids: memberIds });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
