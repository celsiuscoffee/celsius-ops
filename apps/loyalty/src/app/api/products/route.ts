import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/products?brand_id=...&category=...&channel=pickup&featured=true
 *
 * Public read endpoint for product catalog.
 * All apps (loyalty, pickup, delivery) use this same endpoint.
 * No auth required — product catalog is public data.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const brand_id = searchParams.get('brand_id');
    const category = searchParams.get('category');
    const channel = searchParams.get('channel');
    const featured = searchParams.get('featured');
    const search = searchParams.get('search');
    const ids = searchParams.get('ids');
    const all = searchParams.get('all'); // include unavailable (admin)

    if (!brand_id) {
      return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
    }

    let query = supabaseAdmin
      .from('products')
      .select(`
        id, brand_id, storehub_product_id, name, sku, category, tags,
        description, image_url, image_urls, pricing_type, price, cost,
        online_price, grabfood_price, tax_code, tax_rate, modifiers,
        is_available, online_channels, is_featured, is_preorder,
        kitchen_station, track_stock, stock_level, synced_at,
        created_at, updated_at
      `)
      .eq('brand_id', brand_id)
      .order('category')
      .order('name');

    // Only filter available by default (public). Admin passes all=true.
    if (all !== 'true') {
      query = query.eq('is_available', true);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (channel) {
      query = query.contains('online_channels', [channel]);
    }

    if (featured === 'true') {
      query = query.eq('is_featured', true);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
    }

    if (ids) {
      const idList = ids.split(',').map(id => id.trim());
      query = query.in('id', idList);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ products: data || [] });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
