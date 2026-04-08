import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchTransactionCount } from '@/lib/storehub';
import { requireAuth } from '@/lib/auth';

// GET /api/dashboard/kpi?brand_id=brand-celsius&period=monthly|weekly|daily&outlet_id=outlet-sa
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';
    const period = searchParams.get('period') || 'monthly';
    const outletFilter = searchParams.get('outlet_id') || null;

    const now = new Date();
    let fromDate: string;
    const toDate = now.toISOString().split('T')[0];

    if (period === 'daily') {
      fromDate = toDate;
    } else if (period === 'weekly') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    }

    const fromISO = `${fromDate}T00:00:00Z`;
    const toISO = `${toDate}T23:59:59Z`;

    // Build queries with optional outlet filter
    let outletsQuery = supabaseAdmin.from('outlets').select('id, name, storehub_store_id').eq('brand_id', brandId).eq('is_active', true);
    let earnQuery = supabaseAdmin.from('point_transactions').select('outlet_id, member_id').eq('brand_id', brandId).eq('type', 'earn').gte('created_at', fromISO).lte('created_at', toISO);
    const newMembersQuery = supabaseAdmin.from('member_brands').select('member_id', { count: 'exact' }).eq('brand_id', brandId).gte('joined_at', fromISO).lte('joined_at', toISO);
    let returningQuery = supabaseAdmin.from('point_transactions').select('member_id, description').eq('brand_id', brandId).eq('type', 'earn').gte('created_at', fromISO).lte('created_at', toISO);

    if (outletFilter) {
      outletsQuery = outletsQuery.eq('id', outletFilter);
      earnQuery = earnQuery.eq('outlet_id', outletFilter);
      returningQuery = returningQuery.eq('outlet_id', outletFilter);
    }

    const [outletsResult, earnTxnsResult, newMembersResult, returningTxnsResult] = await Promise.all([
      outletsQuery, earnQuery, newMembersQuery, returningQuery,
    ]);

    const outlets = outletsResult.data || [];
    const earnTxns = earnTxnsResult.data || [];

    // New members per outlet: match via first earn transaction
    let newMembersCount = 0;
    if (outletFilter && newMembersResult.data) {
      const newMemberIds = newMembersResult.data.map((m: { member_id: string }) => m.member_id);
      if (newMemberIds.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < newMemberIds.length; i += batchSize) {
          const batch = newMemberIds.slice(i, i + batchSize);
          const { data: firstTxns } = await supabaseAdmin
            .from('point_transactions')
            .select('member_id, outlet_id, created_at')
            .eq('brand_id', brandId)
            .eq('type', 'earn')
            .in('member_id', batch)
            .order('created_at', { ascending: true });
          const seen = new Set<string>();
          for (const txn of firstTxns || []) {
            if (!seen.has(txn.member_id)) {
              seen.add(txn.member_id);
              if (txn.outlet_id === outletFilter) newMembersCount++;
            }
          }
        }
      }
    } else {
      newMembersCount = newMembersResult.count || 0;
    }

    // 1. Collection Rate
    let totalPosOrders = 0;
    const totalLoyaltyClaims = earnTxns.length;
    const outletResults = [];

    for (const outlet of outlets) {
      let posOrders = 0;
      if (outlet.storehub_store_id) {
        try {
          const sh = await fetchTransactionCount(outlet.storehub_store_id, fromDate, toDate);
          posOrders = sh.count;
        } catch { /* StoreHub may not be configured */ }
      }
      const outletClaims = earnTxns.filter(t => t.outlet_id === outlet.id).length;
      totalPosOrders += posOrders;
      outletResults.push({
        outlet_id: outlet.id,
        outlet_name: outlet.name,
        pos_orders: posOrders,
        loyalty_claims: outletClaims,
        claim_rate: posOrders > 0 ? Math.round((outletClaims / posOrders) * 100) : 0,
      });
    }

    const collectionRate = totalPosOrders > 0 ? Math.round((totalLoyaltyClaims / totalPosOrders) * 100) : 0;

    // 3 & 4. Returning members + sales
    const txns = returningTxnsResult.data || [];
    const memberIdsInPeriod = [...new Set(txns.map(t => t.member_id))];
    let returningMembersCount = 0;
    let returningSales = 0;

    if (memberIdsInPeriod.length > 0) {
      const batchSize = 50;
      const returningMemberIds = new Set<string>();

      for (let i = 0; i < memberIdsInPeriod.length; i += batchSize) {
        const batch = memberIdsInPeriod.slice(i, i + batchSize);
        const { data: memberBrands } = await supabaseAdmin
          .from('member_brands')
          .select('member_id, total_visits')
          .eq('brand_id', brandId)
          .in('member_id', batch)
          .gte('total_visits', 2);

        if (memberBrands) {
          for (const mb of memberBrands) returningMemberIds.add(mb.member_id);
        }
      }

      returningMembersCount = returningMemberIds.size;

      for (const txn of txns) {
        if (returningMemberIds.has(txn.member_id)) {
          const match = (txn.description || '').match(/RM\s*([\d.]+)/);
          if (match) returningSales += parseFloat(match[1]) || 0;
        }
      }
    }

    // All outlets for dropdown (always unfiltered)
    const { data: allOutlets } = await supabaseAdmin
      .from('outlets')
      .select('id, name')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('name');

    return NextResponse.json({
      period: { from: fromDate, to: toDate, type: period },
      collection_rate: {
        pos_orders: totalPosOrders,
        loyalty_claims: totalLoyaltyClaims,
        rate: collectionRate,
        outlets: outletResults,
      },
      new_members: newMembersCount,
      returning_members: returningMembersCount,
      returning_sales: Math.round(returningSales * 100) / 100,
      available_outlets: (allOutlets || []).map(o => ({ id: o.id, name: o.name })),
    });
  } catch (err) {
    console.error('[dashboard/kpi] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
