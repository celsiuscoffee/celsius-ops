import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// Shift hour boundaries (MYT = UTC+8)
const SHIFT_HOURS: Record<string, { startH: number; startM: number; endH: number; endM: number }> = {
  morning: { startH: 8, startM: 0, endH: 15, endM: 30 },   // 8:00am – 3:30pm
  evening: { startH: 15, startM: 30, endH: 23, endM: 0 },   // 3:30pm – 11:00pm
};

// Check if a timestamp falls within a shift's time-of-day window (MYT = UTC+8)
function isInShift(dateStr: string, shift: string): boolean {
  const bounds = SHIFT_HOURS[shift];
  if (!bounds) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true; // skip invalid dates
  // Convert to MYT hours/minutes
  // If the string has no timezone indicator (no Z, no +/-), assume it's already MYT
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  let h: number, m: number;
  if (isUTC) {
    // Convert UTC → MYT (UTC+8)
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    h = myt.getUTCHours();
    m = myt.getUTCMinutes();
  } else {
    // Already local time (MYT) — use as-is
    h = d.getUTCHours();
    m = d.getUTCMinutes();
  }
  const mins = h * 60 + m;
  const startMins = bounds.startH * 60 + bounds.startM;
  const endMins = bounds.endH * 60 + bounds.endM;
  return mins >= startMins && mins < endMins;
}

// Fetch order COUNT from StoreHub — only count, don't parse full data
// shift: 'all' | 'morning' | 'evening' — filters by time-of-day per transaction
async function fetchSHOrderCount(storeId: string, from: string, to: string, shift = 'all'): Promise<{ count: number; debug: string }> {
  // STOREHUB_API_KEY is already in "username:password" format
  const shKey = process.env.STOREHUB_API_KEY || '';
  const shApi = process.env.STOREHUB_API_URL || 'https://api.storehubhq.com';

  if (!shKey) {
    return { count: 0, debug: `no_credentials` };
  }
  const auth = Buffer.from(shKey).toString('base64');
  const url = `${shApi}/transactions?storeId=${storeId}&from=${from}&to=${to}&includeOnline=false`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { count: 0, debug: `http_${res.status}` };
    }
    const data = await res.json();
    const txns = Array.isArray(data) ? data : data.transactions || [];
    // Count sales only — optionally filter by shift time-of-day
    // StoreHub fields: transactionTime (preferred), createdAt, completedAt
    let salesCount = 0;
    for (const t of txns) {
      if (t.isCancelled || t.transactionType !== 'Sale') continue;
      if (shift !== 'all') {
        const ts = t.transactionTime || t.createdAt || t.completedAt;
        if (!ts || !isInShift(ts as string, shift)) continue;
      }
      salesCount++;
    }
    return { count: salesCount, debug: `ok: ${salesCount} sales of ${txns.length} txns [shift=${shift}]` };
  } catch (err) {
    return { count: 0, debug: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// GET /api/loyalty/dashboard/kpi?brand_id=brand-celsius&period=monthly|weekly|daily&outlet_id=outlet-sa
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';
    const period = searchParams.get('period') || 'monthly';
    const outletFilter = searchParams.get('outlet_id') || null;
    const shift = searchParams.get('shift') || 'all'; // 'all' | 'morning' | 'evening'

    const now = new Date();
    let fromDate: string;
    let toDate = now.toISOString().split('T')[0];

    if (period === 'custom') {
      fromDate = searchParams.get('from') || toDate;
      toDate = searchParams.get('to') || toDate;
    } else if (period === 'daily') {
      fromDate = toDate;
    } else if (period === 'weekly') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    }

    // Always query the full day range — shift filtering is done per-transaction
    const fromISO = `${fromDate}T00:00:00+08:00`;
    const toISO = `${toDate}T23:59:59+08:00`;

    // Build queries with optional outlet filter
    let outletsQuery = supabaseAdmin.from('outlets').select('id, name, storehub_store_id').eq('brand_id', brandId).eq('is_active', true);
    let earnQuery = supabaseAdmin.from('point_transactions').select('outlet_id, member_id, created_at').eq('brand_id', brandId).eq('type', 'earn').gte('created_at', fromISO).lte('created_at', toISO);
    const newMembersQuery = supabaseAdmin.from('member_brands').select('member_id', { count: 'exact' }).eq('brand_id', brandId).gte('joined_at', fromISO).lte('joined_at', toISO);
    let returningQuery = supabaseAdmin.from('point_transactions').select('member_id, description, created_at').eq('brand_id', brandId).eq('type', 'earn').gte('created_at', fromISO).lte('created_at', toISO);

    if (outletFilter) {
      outletsQuery = outletsQuery.eq('id', outletFilter);
      earnQuery = earnQuery.eq('outlet_id', outletFilter);
      returningQuery = returningQuery.eq('outlet_id', outletFilter);
    }

    const [outletsResult, earnTxnsResult, newMembersResult, returningTxnsResult] = await Promise.all([
      outletsQuery, earnQuery, newMembersQuery, returningQuery,
    ]);

    const outlets = outletsResult.data || [];
    // Filter earn transactions by shift time-of-day if applicable
    const rawEarnTxns = earnTxnsResult.data || [];
    const earnTxns = shift !== 'all'
      ? rawEarnTxns.filter(t => t.created_at && isInShift(t.created_at, shift))
      : rawEarnTxns;

    // New members — if outlet filter, match via first earn transaction
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

    // 1. Collection Rate — fetch StoreHub order counts per outlet
    let totalPosOrders = 0;
    const totalLoyaltyClaims = earnTxns.length;
    const outletResults = [];
    const debugInfo: string[] = [];

    for (const outlet of outlets) {
      let posOrders = 0;
      if (outlet.storehub_store_id) {
        const sh = await fetchSHOrderCount(outlet.storehub_store_id, fromDate, toDate, shift);
        posOrders = sh.count;
        debugInfo.push(`${outlet.name}: ${sh.debug}`);
      } else {
        debugInfo.push(`${outlet.name}: no storehub_store_id`);
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
    const rawReturningTxns = returningTxnsResult.data || [];
    const txns = shift !== 'all'
      ? rawReturningTxns.filter(t => t.created_at && isInShift(t.created_at, shift))
      : rawReturningTxns;
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

    console.log('[loyalty/dashboard/kpi] debug:', JSON.stringify(debugInfo));

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
      _debug: debugInfo,
    });
  } catch (err) {
    console.error('[loyalty/dashboard/kpi] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
