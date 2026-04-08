import { NextRequest, NextResponse } from 'next/server';
import { centralDb } from '@/lib/central-db';
import { createToken, setAuthCookie } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/staff/verify-pin — verify staff PIN against central DB
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

    if (!centralDb) {
      console.error('[verify-pin] Central database not configured');
      return NextResponse.json(
        { error: 'Central database not configured' },
        { status: 500 }
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

    // Find central outlet(s) that map to this loyalty outlet ID
    const { data: outlets, error: outletError } = await centralDb
      .from('Outlet')
      .select('id, name')
      .eq('loyaltyOutletId', outlet_id)
      .eq('status', 'ACTIVE');

    if (outletError) {
      console.error('[verify-pin] Outlet query error:', outletError.message);
      return NextResponse.json({ error: 'Failed to look up outlet' }, { status: 500 });
    }

    if (!outlets?.length) {
      console.error('[verify-pin] No outlet found for loyaltyOutletId:', outlet_id);
      return NextResponse.json({ error: 'Invalid outlet' }, { status: 400 });
    }

    const centralOutletIds = outlets.map((o: { id: string }) => o.id);

    // Fetch active users with loyalty access and a PIN set
    const { data: users, error: userError } = await centralDb
      .from('User')
      .select('id, name, email, role, pin, outletId, outletIds, appAccess')
      .eq('status', 'ACTIVE')
      .not('pin', 'is', null);

    if (userError) {
      console.error('[verify-pin] User query error:', userError.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    console.log(`[verify-pin] Found ${users?.length ?? 0} users with PINs, checking outlet ${outlet_id} -> central ${centralOutletIds.join(',')}`);

    // Filter users who have loyalty access, outlet access, and matching PIN
    let matchedUser = null;
    const outletName = outlets[0]?.name || '';

    for (const user of users || []) {
      // Check appAccess includes "loyalty"
      const appAccess = user.appAccess as string[] | null;
      if (!appAccess || !appAccess.includes('loyalty')) continue;

      // Check if user is assigned to any of the central outlets
      const userOutletIds = (user.outletIds as string[]) || [];
      const hasOutletAccess =
        centralOutletIds.includes(user.outletId) ||
        userOutletIds.some((id: string) => centralOutletIds.includes(id));

      if (!hasOutletAccess) continue;

      // PIN is stored as plaintext in central DB — direct comparison
      if (user.pin === pin.trim()) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      console.log('[verify-pin] No matching user found for PIN at outlet', outlet_id);
      return NextResponse.json(
        { error: 'Invalid PIN or outlet' },
        { status: 401 }
      );
    }

    console.log(`[verify-pin] Login success: ${matchedUser.name} at ${outletName}`);

    // Issue JWT token for portal session
    const token = await createToken({
      id: matchedUser.id,
      email: matchedUser.email || `staff-${matchedUser.id}@portal`,
      name: matchedUser.name,
      role: (matchedUser.role as string)?.toLowerCase() || 'staff',
    });

    const response = NextResponse.json({
      success: true,
      staff_name: matchedUser.name,
      outlet_name: outletName,
      staff: {
        id: matchedUser.id,
        name: matchedUser.name,
        email: matchedUser.email,
        role: matchedUser.role,
      },
      outlet: { id: outlet_id, name: outletName },
    });

    return setAuthCookie(response, token);
  } catch (err) {
    console.error('[verify-pin] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
