import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncProducts } from '@/lib/storehub-products';
import { checkCronAuth } from '@celsius/shared';

/**
 * GET /api/cron/sync-products
 *
 * Vercel Cron job — runs every 6 hours.
 * Syncs product catalog from StoreHub → Supabase.
 * Protected by CRON_SECRET header.
 */
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    // Get all active brands with their outlets
    const { data: outlets } = await supabaseAdmin
      .from('outlets')
      .select('id, brand_id, storehub_store_id')
      .eq('is_active', true)
      .not('storehub_store_id', 'is', null);

    if (!outlets || outlets.length === 0) {
      return NextResponse.json({ message: 'No outlets to sync', synced: 0 });
    }

    // Group by brand — sync once per brand (products shared across stores)
    const brandStoreMap = new Map<string, string>();
    for (const outlet of outlets) {
      if (!brandStoreMap.has(outlet.brand_id) && outlet.storehub_store_id) {
        brandStoreMap.set(outlet.brand_id, outlet.storehub_store_id);
      }
    }

    let totalSynced = 0;
    let totalErrors = 0;

    for (const [brandId, storeId] of brandStoreMap) {
      const result = await syncProducts(brandId, storeId);
      totalSynced += result.synced;
      totalErrors += result.errors;
    }

    return NextResponse.json({
      success: true,
      brands_synced: brandStoreMap.size,
      products_synced: totalSynced,
      errors: totalErrors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron sync-products error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
