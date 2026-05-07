import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createToken, setAuthCookie } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { verifyPin, hashPin } from '@celsius/auth';

// POST /api/staff/verify-pin — verify staff PIN
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

    // Find central outlet(s) that map to this loyalty outlet ID
    const { data: outlets, error: outletError } = await supabaseAdmin
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
    const { data: users, error: userError } = await supabaseAdmin
      .from('User')
      .select('id, name, email, role, pin, outletId, outletIds, appAccess')
      .eq('status', 'ACTIVE')
      .not('pin', 'is', null);

    if (userError) {
      console.error('[verify-pin] User query error:', userError.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    console.log(`[verify-pin] Found ${users?.length ?? 0} users with PINs, checking outlet ${outlet_id} -> central ${centralOutletIds.join(',')}`);

    // Two passes so the error message can tell the admin WHICH gate fired.
    // Pass 1: any user (regardless of appAccess) whose PIN matches at this
    // outlet. If we find one but they lack loyalty access, surface that
    // explicitly — saves hours of "Invalid PIN" head-scratching when the
    // real issue is missing scope. Pass 2 actually completes the login if
    // both gates pass.
    type StaffRow = NonNullable<typeof users>[number];
    let pinMatchedUser: StaffRow | null = null;
    let matchedUser: StaffRow | null = null;
    const outletName = outlets[0]?.name || '';

    for (const user of users || []) {
      const userOutletIds = (user.outletIds as string[]) || [];
      const hasOutletAccess =
        centralOutletIds.includes(user.outletId) ||
        userOutletIds.some((id: string) => centralOutletIds.includes(id));
      if (!hasOutletAccess) continue;

      const { match, needsRehash } = await verifyPin(pin, user.pin as string);
      if (!match) continue;

      // PIN matched + outlet matched. Now check loyalty appAccess.
      const appAccess = user.appAccess as string[] | null;
      const hasLoyalty = !!appAccess?.includes('loyalty');
      // OWNER/ADMIN bypass — consistent with staff + backoffice PIN gates.
      const role = (user.role as string)?.toUpperCase();
      const roleBypass = role === 'OWNER' || role === 'ADMIN';

      if (!pinMatchedUser) pinMatchedUser = user;
      if (hasLoyalty || roleBypass) {
        if (needsRehash && supabaseAdmin) {
          const hashed = await hashPin(pin);
          await supabaseAdmin.from('User').update({ pin: hashed }).eq('id', user.id);
        }
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      if (pinMatchedUser) {
        // PIN was correct but user lacks the loyalty appAccess scope.
        console.log('[verify-pin] PIN matched but loyalty access missing:', (pinMatchedUser as { id: string }).id);
        return NextResponse.json(
          { error: 'PIN ok but no loyalty access — ask an admin to enable Loyalty for your account.' },
          { status: 403 }
        );
      }
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
