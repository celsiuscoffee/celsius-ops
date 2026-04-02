import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { syncProducts } from '@/lib/storehub-products';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/products/sync
 *
 * Triggers a product sync from StoreHub → Supabase.
 * Requires admin auth. Can be called manually from admin panel
 * or via cron job with an API key.
 */
export async function POST(request: NextRequest) {
  try {
    // Allow cron jobs with API key header
    const cronKey = request.headers.get('x-cron-key');
    if (cronKey && cronKey === process.env.CRON_SECRET) {
      // Cron-authenticated — proceed
    } else {
      // Require staff/admin auth
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;
      if (auth.user?.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const { brand_id, store_id } = await request.json();

    if (!brand_id) {
      return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
    }

    // If store_id provided, sync just that store
    if (store_id) {
      const result = await syncProducts(brand_id, store_id);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // Otherwise sync all outlets for this brand
    const { data: outlets } = await supabaseAdmin
      .from('outlets')
      .select('id, storehub_store_id')
      .eq('brand_id', brand_id)
      .eq('is_active', true)
      .not('storehub_store_id', 'is', null);

    if (!outlets || outlets.length === 0) {
      return NextResponse.json({
        error: 'No outlets with StoreHub store IDs found',
      }, { status: 404 });
    }

    let totalSynced = 0;
    let totalErrors = 0;

    // Sync from the first outlet (products are shared across stores in StoreHub)
    const firstOutlet = outlets[0];
    if (firstOutlet.storehub_store_id) {
      const result = await syncProducts(brand_id, firstOutlet.storehub_store_id);
      totalSynced = result.synced;
      totalErrors = result.errors;
    }

    return NextResponse.json({
      success: true,
      synced: totalSynced,
      errors: totalErrors,
      outlet_used: firstOutlet.id,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
