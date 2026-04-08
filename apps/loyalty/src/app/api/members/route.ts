import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth, getAuthUser } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// GET /api/members?brand_id=brand-celsius&phone=+60123456789&page=0&limit=50&search=keyword
// Fetch members with their brand data. Supports pagination and search.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const phone = searchParams.get('phone');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') ?? '0');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);
    const all = searchParams.get('all') === 'true'; // for SMS blast — fetch all phones only

    // Admin-only access: if fetching all members or browsing by brand (no phone lookup)
    if (!phone) {
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;
    } else {
      // Rate limit phone lookups to prevent enumeration
      const rateCheck = await checkRateLimit(phone, RATE_LIMITS.PHONE_LOOKUP);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
      }
    }

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    // Fast path: fetch all members (for admin members page & SMS blast)
    // Supabase REST API caps at 1000 rows — paginate to get all
    if (all) {
      const allMembers: Record<string, unknown>[] = [];
      const PAGE = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabaseAdmin
          .from('members')
          .select('id, phone, name, email, birthday, tags, created_at, updated_at, preferred_outlet_id, brand_data:member_brands!inner(points_balance, total_visits, total_spent, total_points_earned, joined_at, last_visit_at)')
          .eq('member_brands.brand_id', brandId)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (data && data.length > 0) {
          allMembers.push(...data);
          offset += PAGE;
          hasMore = data.length === PAGE;
        } else {
          hasMore = false;
        }
      }

      const members = allMembers.map((member) => ({
        ...member,
        brand_data: Array.isArray(member.brand_data)
          ? member.brand_data[0]
          : member.brand_data,
      }));

      return NextResponse.json(members);
    }

    // Single phone lookup — try all possible formats to handle migrated data
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      const variants = new Set<string>();
      variants.add(phone); // as-is
      // +60XXXXXXXXX format
      if (digits.startsWith('60')) variants.add(`+${digits}`);
      else if (digits.startsWith('0')) variants.add(`+6${digits}`);
      else variants.add(`+60${digits}`);
      // 60XXXXXXXXX (no +)
      if (digits.startsWith('60')) variants.add(digits);
      else if (digits.startsWith('0')) variants.add(`6${digits}`);
      // 0XXXXXXXXX local
      if (digits.startsWith('60')) variants.add(`0${digits.slice(2)}`);
      else if (!digits.startsWith('0')) variants.add(`0${digits}`);
      else variants.add(digits);

      const { data, error } = await supabaseAdmin
        .from('members')
        .select(`*, brand_data:member_brands!inner(*)`)
        .eq('member_brands.brand_id', brandId)
        .in('phone', [...variants]);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const members = (data ?? []).map((member: Record<string, unknown>) => ({
        ...member,
        brand_data: Array.isArray(member.brand_data)
          ? member.brand_data[0]
          : member.brand_data,
      }));

      return NextResponse.json(members);
    }

    // Sanitize search to prevent filter injection (escape commas, dots, parens)
    const safeSearch = search ? search.replace(/[%,;()"']/g, '') : '';

    // Run count + data queries in parallel
    let countQuery = supabaseAdmin
      .from('members')
      .select('*, brand_data:member_brands!inner(*)', { count: 'exact', head: true })
      .eq('member_brands.brand_id', brandId);

    let dataQuery = supabaseAdmin
      .from('members')
      .select(`*, brand_data:member_brands!inner(*)`)
      .eq('member_brands.brand_id', brandId);

    if (safeSearch) {
      const filter = `name.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`;
      countQuery = countQuery.or(filter);
      dataQuery = dataQuery.or(filter);
    }

    dataQuery = dataQuery
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);

    const [{ count }, { data, error }] = await Promise.all([countQuery, dataQuery]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Flatten brand_data from array to single object
    const members = (data ?? []).map((member: Record<string, unknown>) => ({
      ...member,
      brand_data: Array.isArray(member.brand_data)
        ? member.brand_data[0]
        : member.brand_data,
    }));

    return NextResponse.json({
      members,
      total: count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/members — create a new member
// Body: { phone, name?, email?, birthday?, brand_id, outlet_id? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, name, email, birthday, brand_id, outlet_id } = body;

    if (!phone || !brand_id) {
      return NextResponse.json(
        { error: 'phone and brand_id are required' },
        { status: 400 }
      );
    }

    // Rate limit member creation by phone (skip for authenticated staff/admin)
    const authUser = await getAuthUser(request);
    if (!authUser) {
      const rateCheck = await checkRateLimit(phone, RATE_LIMITS.MEMBER_CREATE);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
      }
    }

    // Check if member with this phone already exists (any format)
    const d = phone.replace(/\D/g, '');
    const phoneVariants: string[] = [phone];
    if (d.startsWith('60')) { phoneVariants.push(`+${d}`, d, `0${d.slice(2)}`); }
    else if (d.startsWith('0')) { phoneVariants.push(`+6${d}`, `6${d}`, d); }
    else { phoneVariants.push(`+60${d}`, `60${d}`, `0${d}`); }

    const { data: existingList } = await supabaseAdmin
      .from('members')
      .select('id, phone')
      .in('phone', [...new Set(phoneVariants)]);

    const existing = existingList && existingList.length > 0 ? existingList[0] : null;

    let memberId: string;

    if (existing) {
      memberId = existing.id;

      // Check if they already have a member_brands record for this brand
      const { data: existingBrand } = await supabaseAdmin
        .from('member_brands')
        .select('id')
        .eq('member_id', memberId)
        .eq('brand_id', brand_id)
        .maybeSingle();

      if (existingBrand) {
        return NextResponse.json(
          { error: 'Member already exists for this brand' },
          { status: 409 }
        );
      }
    } else {
      // Create new member
      const newId = `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const { data: newMember, error: memberError } = await supabaseAdmin
        .from('members')
        .insert({
          id: newId,
          phone,
          name: name || null,
          email: email || null,
          birthday: birthday || null,
          preferred_outlet_id: outlet_id || null,
        })
        .select()
        .single();

      if (memberError) {
        return NextResponse.json(
          { error: memberError.message },
          { status: 500 }
        );
      }

      memberId = newMember.id;
    }

    // Create member_brands record with 0 points
    const mbId = `mb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: memberBrand, error: mbError } = await supabaseAdmin
      .from('member_brands')
      .insert({
        id: mbId,
        member_id: memberId,
        brand_id,
        points_balance: 0,
        total_points_earned: 0,
        total_points_redeemed: 0,
        total_visits: 0,
        total_spent: 0,
      })
      .select()
      .single();

    if (mbError) {
      return NextResponse.json({ error: mbError.message }, { status: 500 });
    }

    // Auto-issue new member rewards
    try {
      const { data: newMemberRewards } = await supabaseAdmin
        .from('rewards')
        .select('*')
        .eq('brand_id', brand_id)
        .eq('reward_type', 'new_member')
        .eq('auto_issue', true)
        .eq('is_active', true);

      if (newMemberRewards && newMemberRewards.length > 0) {
        for (const reward of newMemberRewards) {
          const code = `NM-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const expiresAt = reward.validity_days
            ? new Date(Date.now() + reward.validity_days * 24 * 60 * 60 * 1000).toISOString()
            : null;

          await supabaseAdmin.from('issued_rewards').insert({
            id: `ir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            member_id: memberId,
            reward_id: reward.id,
            brand_id,
            expires_at: expiresAt,
            status: 'active',
            code,
            year: null,
          });
        }
      }
    } catch {
      // Don't fail member creation if reward issuance fails
    }

    // Fetch the full member with brand data
    const { data: fullMember, error: fetchError } = await supabaseAdmin
      .from('members')
      .select(`
        *,
        brand_data:member_brands!inner(*)
      `)
      .eq('id', memberId)
      .eq('member_brands.brand_id', brand_id)
      .single();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    const result = {
      ...fullMember,
      brand_data: Array.isArray(fullMember.brand_data)
        ? fullMember.brand_data[0]
        : fullMember.brand_data,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[members POST] Error:', message, err);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// PUT /api/members?id=<member_id> — update a member
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.birthday !== undefined) updates.birthday = body.birthday || null;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.sms_opt_out !== undefined) updates.sms_opt_out = body.sms_opt_out;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('members')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/members?id=<member_id> — delete a member and related data
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Delete related records first (order matters for FK constraints)
    await supabaseAdmin.from('issued_rewards').delete().eq('member_id', id);
    await supabaseAdmin.from('redemptions').delete().eq('member_id', id);
    await supabaseAdmin.from('sms_logs').delete().eq('member_id', id);
    await supabaseAdmin.from('point_transactions').delete().eq('member_id', id);
    await supabaseAdmin.from('member_brands').delete().eq('member_id', id);

    const { error } = await supabaseAdmin.from('members').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
