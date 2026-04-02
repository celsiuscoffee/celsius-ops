import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchTransactionCount } from '@/lib/storehub';
import { requireAuth } from '@/lib/auth';

// GET /api/storehub/compare?brand_id=brand-celsius&from=2026-03-01&to=2026-03-28
// Compares StoreHub POS orders vs loyalty point claims per outlet
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!brandId) {
      return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
    }

    // Default date range: current month
    const now = new Date();
    const fromDate = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const toDate = to || now.toISOString().split('T')[0];

    // 1. Fetch all active outlets with storehub_store_id
    const { data: outlets, error: outletsError } = await supabaseAdmin
      .from('outlets')
      .select('id, name, storehub_store_id')
      .eq('brand_id', brandId)
      .eq('is_active', true);

    if (outletsError || !outlets) {
      return NextResponse.json({ error: outletsError?.message || 'No outlets' }, { status: 500 });
    }

    // 2. Count loyalty point_transactions (type=earn) per outlet in the date range
    const { data: loyaltyData, error: loyaltyError } = await supabaseAdmin
      .from('point_transactions')
      .select('outlet_id')
      .eq('brand_id', brandId)
      .eq('type', 'earn')
      .gte('created_at', `${fromDate}T00:00:00Z`)
      .lte('created_at', `${toDate}T23:59:59Z`);

    if (loyaltyError) {
      return NextResponse.json({ error: loyaltyError.message }, { status: 500 });
    }

    // Count claims per outlet
    const claimsByOutlet: Record<string, number> = {};
    for (const row of loyaltyData || []) {
      const oid = row.outlet_id as string;
      claimsByOutlet[oid] = (claimsByOutlet[oid] || 0) + 1;
    }

    // 3. Fetch StoreHub order counts per outlet (parallel)
    const results = await Promise.all(
      outlets.map(async (outlet) => {
        const storeId = outlet.storehub_store_id;
        let storehub_orders = 0;
        let storehub_sales = 0;

        if (storeId) {
          const sh = await fetchTransactionCount(storeId, fromDate, toDate);
          storehub_orders = sh.count;
          storehub_sales = sh.total_sales;
        }

        const loyalty_claims = claimsByOutlet[outlet.id] || 0;
        const claim_rate = storehub_orders > 0
          ? Math.round((loyalty_claims / storehub_orders) * 100)
          : 0;

        return {
          outlet_id: outlet.id,
          outlet_name: outlet.name,
          storehub_orders,
          storehub_sales,
          loyalty_claims,
          claim_rate,
        };
      })
    );

    // 4. Totals
    const totals = results.reduce(
      (acc, r) => ({
        storehub_orders: acc.storehub_orders + r.storehub_orders,
        storehub_sales: acc.storehub_sales + r.storehub_sales,
        loyalty_claims: acc.loyalty_claims + r.loyalty_claims,
      }),
      { storehub_orders: 0, storehub_sales: 0, loyalty_claims: 0 }
    );

    const overall_claim_rate = totals.storehub_orders > 0
      ? Math.round((totals.loyalty_claims / totals.storehub_orders) * 100)
      : 0;

    return NextResponse.json({
      period: { from: fromDate, to: toDate },
      outlets: results,
      totals: { ...totals, claim_rate: overall_claim_rate },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
