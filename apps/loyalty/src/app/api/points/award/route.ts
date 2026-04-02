import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { randomInt } from 'crypto';

// POST /api/points/award — award points to a member
// Body: { member_id, brand_id, outlet_id, points, description, reference_id?, multiplier? }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const {
      member_id,
      brand_id,
      outlet_id,
      points,
      amount,
      description,
      reference_id,
      multiplier = 1,
    } = body;

    if (!member_id || !brand_id || !outlet_id || !points || !description) {
      return NextResponse.json(
        {
          error:
            'member_id, brand_id, outlet_id, points, and description are required',
        },
        { status: 400 }
      );
    }

    if (points <= 0 || !Number.isFinite(points)) {
      return NextResponse.json(
        { error: 'points must be a positive number' },
        { status: 400 }
      );
    }

    if (points > 10000) {
      return NextResponse.json(
        { error: 'points exceed maximum per transaction (10,000)' },
        { status: 400 }
      );
    }

    const safeMultiplier = Math.min(Math.max(multiplier, 1), 10);
    const effectivePoints = points * safeMultiplier;

    // Fetch current member_brands record
    const { data: memberBrand, error: mbError } = await supabaseAdmin
      .from('member_brands')
      .select('*')
      .eq('member_id', member_id)
      .eq('brand_id', brand_id)
      .single();

    if (mbError || !memberBrand) {
      return NextResponse.json(
        { error: 'Member not found for this brand' },
        { status: 404 }
      );
    }

    const newBalance = memberBrand.points_balance + effectivePoints;

    // Atomic update with optimistic concurrency control
    const { data: updateData, error: updateError } = await supabaseAdmin
      .from('member_brands')
      .update({
        points_balance: newBalance,
        total_points_earned:
          memberBrand.total_points_earned + effectivePoints,
        total_visits: memberBrand.total_visits + 1,
        total_spent: memberBrand.total_spent + (amount || points), // actual RM amount spent
        last_visit_at: new Date().toISOString(),
      })
      .eq('id', memberBrand.id)
      .eq('points_balance', memberBrand.points_balance) // Optimistic concurrency: fails if balance changed
      .select()
      .single();

    if (updateError || !updateData) {
      return NextResponse.json(
        { error: 'Balance changed concurrently, please retry' },
        { status: 409 }
      );
    }

    // Update member's preferred outlet to the current outlet
    if (outlet_id) {
      await supabaseAdmin
        .from('members')
        .update({ preferred_outlet_id: outlet_id })
        .eq('id', member_id);
    }

    // Create point_transaction record
    const txnId = `txn-${Date.now()}-${randomInt(1000, 9999)}`;
    const { data: transaction, error: txnError } = await supabaseAdmin
      .from('point_transactions')
      .insert({
        id: txnId,
        member_id,
        brand_id,
        outlet_id,
        type: 'earn',
        points: effectivePoints,
        balance_after: newBalance,
        description,
        reference_id: reference_id || null,
        multiplier: safeMultiplier,
      })
      .select()
      .single();

    if (txnError) {
      return NextResponse.json({ error: txnError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      transaction,
      new_balance: newBalance,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
