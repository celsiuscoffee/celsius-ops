import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/issued-rewards?brand_id=X&member_id=Y — fetch issued rewards
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const memberId = searchParams.get('member_id');

    if (!brandId) {
      return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
    }

    // Flat select — the earlier `reward:rewards(...)` embed depended
    // on an FK relationship not declared in PostgREST, so the
    // Vouchers Issued page rendered empty even though 100+ rows
    // exist. issued_rewards holds both legacy points-shop
    // redemptions (reward_id set) and new wallet vouchers
    // (voucher_template_id set). The `title` column is denormalised
    // and carries the display name for both shapes.
    let query = supabaseAdmin
      .from('issued_rewards')
      .select('id, member_id, voucher_template_id, reward_id, source_type, title, description, icon, category, status, issued_at, expires_at, redeemed_at')
      .eq('brand_id', brandId)
      .order('issued_at', { ascending: false })
      .limit(500);

    if (memberId) {
      query = query.eq('member_id', memberId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Row = {
      id: string; member_id: string; voucher_template_id: string | null;
      reward_id: string | null; source_type: string | null;
      title: string | null; description: string | null; icon: string | null;
      category: string | null; status: string;
      issued_at: string; expires_at: string | null; redeemed_at: string | null;
    };
    const rows = (data ?? []) as Row[];

    // Batched member lookup — one round-trip regardless of voucher
    // count, keyed by member_id. Page renders name + phone instead
    // of the raw uuid prefix.
    const memberIds = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)));
    const memberById = new Map<string, { name: string | null; phone: string | null }>();
    if (memberIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from('members')
        .select('id, name, phone')
        .in('id', memberIds);
      type MRow = { id: string; name: string | null; phone: string | null };
      for (const m of ((members ?? []) as MRow[])) {
        memberById.set(m.id, { name: m.name, phone: m.phone });
      }
    }

    const out = rows.map((r) => {
      const m = memberById.get(r.member_id);
      return {
        ...r,
        member_name: m?.name ?? null,
        member_phone: m?.phone ?? null,
      };
    });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/issued-rewards — update status (e.g. mark as used)
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'id and status are required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = { status };

    const { data, error } = await supabaseAdmin
      .from('issued_rewards')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
