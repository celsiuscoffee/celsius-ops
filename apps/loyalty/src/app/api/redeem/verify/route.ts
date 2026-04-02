import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// POST /api/redeem/verify — staff verifies and confirms a redemption code
// Body: { code, staff_id? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { code, staff_id } = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Redemption code is required' }, { status: 400 });
    }

    // Look up the redemption by code
    const { data: redemption, error } = await supabaseAdmin
      .from('redemptions')
      .select(`
        *,
        rewards:reward_id ( name, description, category, image_url, points_required ),
        members:member_id ( name, phone )
      `)
      .eq('code', code.toUpperCase().trim())
      .single();

    if (error || !redemption) {
      return NextResponse.json({ error: 'Invalid redemption code' }, { status: 404 });
    }

    // Check status
    if (redemption.status === 'confirmed') {
      return NextResponse.json({
        error: 'This code has already been used',
        redemption: {
          code: redemption.code,
          status: redemption.status,
          confirmed_at: redemption.confirmed_at,
          reward: redemption.rewards,
          member: redemption.members,
        },
      }, { status: 400 });
    }

    if (redemption.status === 'cancelled') {
      return NextResponse.json({ error: 'This redemption has been cancelled' }, { status: 400 });
    }

    if (redemption.status !== 'pending') {
      return NextResponse.json({ error: `Unexpected redemption status: ${redemption.status}` }, { status: 400 });
    }

    // Confirm the redemption
    const { error: updateError } = await supabaseAdmin
      .from('redemptions')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: staff_id || null,
      })
      .eq('id', redemption.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      redemption: {
        code: redemption.code,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        points_spent: redemption.points_spent,
        reward: redemption.rewards,
        member: redemption.members,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/redeem/verify?code=RDM-XXXX-XXXX — look up a redemption code without confirming
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'code parameter is required' }, { status: 400 });
  }

  const { data: redemption, error } = await supabaseAdmin
    .from('redemptions')
    .select(`
      *,
      rewards:reward_id ( name, description, category, image_url, points_required ),
      members:member_id ( name, phone )
    `)
    .eq('code', code.toUpperCase().trim())
    .single();

  if (error || !redemption) {
    return NextResponse.json({ error: 'Invalid redemption code' }, { status: 404 });
  }

  return NextResponse.json({
    redemption: {
      code: redemption.code,
      status: redemption.status,
      points_spent: redemption.points_spent,
      created_at: redemption.created_at,
      confirmed_at: redemption.confirmed_at,
      reward: redemption.rewards,
      member: redemption.members,
    },
  });
}
