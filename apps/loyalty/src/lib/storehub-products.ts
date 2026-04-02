// ==========================================
// StoreHub Product Sync Service
// Pulls product catalog from StoreHub API
// and upserts into Supabase products tables.
// This is the SINGLE source of sync — all apps
// read from Supabase, not StoreHub directly.
// ==========================================

import { supabaseAdmin } from './supabase';

const API_URL = process.env.STOREHUB_API_URL || 'https://api.storehubhq.com';
const USERNAME = process.env.STOREHUB_USERNAME || '';
const API_KEY = process.env.STOREHUB_API_KEY || '';

function getAuthHeader(): string {
  const credentials = Buffer.from(`${USERNAME}:${API_KEY}`).toString('base64');
  return `Basic ${credentials}`;
}

// Raw StoreHub product shape (from their API)
interface StoreHubProduct {
  _id: string;
  name: string;
  sku?: string;
  category?: { _id?: string; name?: string };
  tags?: string[];
  description?: string;
  imageUrl?: string;
  images?: string[];
  pricingType?: string;     // "fixed", "variable", "weight"
  price?: number;
  costPrice?: number;
  onlinePrice?: number;
  grabFoodPrice?: number;
  taxCode?: string;
  taxRate?: number;
  modifiers?: Array<{
    name?: string;
    type?: string;            // "single", "multiple"
    required?: boolean;
    min?: number;
    max?: number;
    options?: Array<{
      name?: string;
      price?: number;
      isDefault?: boolean;
    }>;
  }>;
  isAvailable?: boolean;
  onlineChannels?: string[];
  isFeatured?: boolean;
  isPreOrder?: boolean;
  kitchenStation?: string;
  trackStock?: boolean;
  stockLevel?: number;
  variants?: Array<{
    _id?: string;
    name?: string;
    sku?: string;
    barcode?: string;
    price?: number;
    costPrice?: number;
    stockLevel?: number;
    isAvailable?: boolean;
  }>;
  storeId?: string;
  updatedAt?: string;
}

/**
 * Fetch all products from StoreHub for a given store
 */
export async function fetchStoreHubProducts(storeId: string): Promise<StoreHubProduct[]> {
  const url = `${API_URL}/products?storeId=${storeId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`StoreHub Products API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.products || [];
  } catch (error) {
    console.error('StoreHub Products fetch error:', error);
    return [];
  }
}

/**
 * Sync products from StoreHub into Supabase
 * Upserts based on storehub_product_id to avoid duplicates
 */
export async function syncProducts(
  brandId: string,
  storeId: string
): Promise<{ synced: number; errors: number }> {
  const products = await fetchStoreHubProducts(storeId);
  let synced = 0;
  let errors = 0;

  for (const p of products) {
    try {
      const productId = `prod-${p._id}`;
      const now = new Date().toISOString();

      // Upsert product
      const { error } = await supabaseAdmin
        .from('products')
        .upsert({
          id: productId,
          brand_id: brandId,
          storehub_product_id: p._id,
          name: p.name,
          sku: p.sku || null,
          category: p.category?.name || null,
          tags: p.tags || [],
          description: p.description || null,
          image_url: p.imageUrl || null,
          image_urls: p.images || [],
          pricing_type: p.pricingType || 'fixed',
          price: p.price || 0,
          cost: p.costPrice ?? null,
          online_price: p.onlinePrice ?? null,
          grabfood_price: p.grabFoodPrice ?? null,
          tax_code: p.taxCode || null,
          tax_rate: p.taxRate || 0,
          modifiers: (p.modifiers || []).map(m => ({
            group: m.name || 'Unnamed',
            type: m.type === 'multiple' ? 'multiple' : 'single',
            required: m.required ?? false,
            min: m.min ?? 0,
            max: m.max ?? 0,
            options: (m.options || []).map(o => ({
              name: o.name || '',
              price: o.price || 0,
              is_default: o.isDefault || false,
            })),
          })),
          is_available: p.isAvailable !== false,
          online_channels: p.onlineChannels || [],
          is_featured: p.isFeatured || false,
          is_preorder: p.isPreOrder || false,
          kitchen_station: p.kitchenStation || null,
          track_stock: p.trackStock || false,
          stock_level: p.stockLevel ?? null,
          synced_at: now,
          storehub_updated_at: p.updatedAt || null,
          updated_at: now,
        }, { onConflict: 'storehub_product_id' });

      if (error) {
        console.error(`Failed to sync product ${p.name}:`, error.message);
        errors++;
        continue;
      }

      // Sync variants if present
      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          const variantId = `pv-${v._id || `${p._id}-${v.name}`}`;
          await supabaseAdmin
            .from('product_variants')
            .upsert({
              id: variantId,
              product_id: productId,
              name: v.name || 'Default',
              sku: v.sku || null,
              barcode: v.barcode || null,
              price: v.price ?? null,
              cost: v.costPrice ?? null,
              stock_level: v.stockLevel ?? null,
              storehub_variant_id: v._id || null,
              is_available: v.isAvailable !== false,
            }, { onConflict: 'id' });
        }
      }

      // Sync category
      if (p.category?.name) {
        const catSlug = p.category.name.toLowerCase().replace(/\s+/g, '-');
        await supabaseAdmin
          .from('product_categories')
          .upsert({
            id: `cat-${brandId}-${catSlug}`,
            brand_id: brandId,
            name: p.category.name,
            slug: catSlug,
            storehub_category_id: p.category._id || null,
            is_active: true,
          }, { onConflict: 'id' });
      }

      synced++;
    } catch (err) {
      console.error(`Error syncing product ${p.name}:`, err);
      errors++;
    }
  }

  return { synced, errors };
}
