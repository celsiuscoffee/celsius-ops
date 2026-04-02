import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPin, createToken, setAuthCookie } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/staff/verify-pin — verify staff PIN for portal login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { outlet_id, pin } = body;

    if (!outlet_id || !pin) {
      return NextResponse.json(
        { error: 'outlet_id and pin are required' },
        { status: 400 }
      );
    }

    // Rate limit by outlet
    const rateCheck = await checkRateLimit(outlet_id, RATE_LIMITS.STAFF_PIN);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${rateCheck.retryAfter} seconds.` },
        { status: 429 }
      );
    }

    // Fetch active staff who have access to this outlet
    const { data: staffList, error } = await supabaseAdmin
      .from('staff_users')
      .select('id, name, email, role, outlet_id, outlet_ids, brand_id, pin_hash')
      .eq('is_active', true)
      .or(`outlet_id.eq.${outlet_id},outlet_ids.cs.{"${outlet_id}"}`);

    if (error) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Find staff with matching PIN
    let matchedStaff = null;
    for (const s of staffList || []) {
      if (!s.pin_hash) continue;
      const pinMatch = await verifyPin(pin, s.pin_hash);
      if (pinMatch) {
        matchedStaff = s;
        break;
      }
    }

    if (!matchedStaff) {
      return NextResponse.json(
        { error: 'Invalid PIN or outlet' },
        { status: 401 }
      );
    }

    // Fetch outlet info
    const { data: outlet } = await supabaseAdmin
      .from('outlets')
      .select('id, name, brand_id')
      .eq('id', outlet_id)
      .single();

    // Issue JWT token so staff can call authenticated APIs (e.g. /api/redeem)
    const token = await createToken({
      id: matchedStaff.id,
      email: matchedStaff.email || `staff-${matchedStaff.id}@portal`,
      name: matchedStaff.name,
      role: matchedStaff.role || 'staff',
    });

    const response = NextResponse.json({
      success: true,
      staff_name: matchedStaff.name,
      outlet_name: outlet?.name || "",
      staff: {
        id: matchedStaff.id,
        name: matchedStaff.name,
        email: matchedStaff.email,
        role: matchedStaff.role,
      },
      outlet: outlet || null,
    });

    return setAuthCookie(response, token);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
