/**
 * Sync StoreHub products → Supabase
 * Uses the ACTUAL live schema (loyalty app schema):
 *   products: id, brand_id, category (slug text), name, description, price (RM),
 *             image_url, is_available, is_featured, modifiers
 *   categories: id, name, slug, position
 *
 * Usage: node scripts/sync-products.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STOREHUB_API_KEY = process.env.STOREHUB_API_KEY?.trim();
const BRAND_ID = 'brand-celsius';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!STOREHUB_API_KEY) {
  console.error('Missing STOREHUB_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const AUTH_HEADER = `Basic ${Buffer.from(STOREHUB_API_KEY).toString('base64')}`;
const STOREHUB_BASE = 'https://api.storehubhq.com';

async function storehubFetch(path) {
  const res = await fetch(`${STOREHUB_BASE}${path}`, {
    headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`StoreHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const MULTI_SELECT = new Set(['add on', 'add ons', 'add-on', 'add-ons']);

async function main() {
  console.log('Fetching products from StoreHub...');
  const shProducts = await storehubFetch('/products');
  console.log(`  Got ${shProducts.length} products`);

  // Derive categories from product category names
  const categoryNames = [...new Set(
    shProducts.map(p => p.category).filter(Boolean)
  )].sort();

  const categoryRows = categoryNames.map((name, i) => ({
    id: slugify(name),
    name,
    slug: slugify(name),
    position: i + 1,
  }));

  console.log(`\nUpserting ${categoryRows.length} categories...`);
  const { error: catError } = await supabase
    .from('categories')
    .upsert(categoryRows, { onConflict: 'id' });
  if (catError) throw new Error(`Category upsert: ${catError.message}`);
  console.log('  Categories OK');

  // Preserve existing product data (images, featured flag, etc.)
  const { data: existing } = await supabase
    .from('products')
    .select('id, image_url, is_featured')
    .eq('brand_id', BRAND_ID);

  const existingMap = new Map(
    (existing ?? []).map(p => [p.id, {
      image_url: p.image_url ?? '',
      is_featured: p.is_featured ?? false,
    }])
  );
  console.log(`  Preserving ${existingMap.size} existing product images/flags`);

  // Fetch store IDs from outlet_settings for inventory
  const { data: storeHubStores } = await supabase.from('outlet_settings').select('store_id');
  const storeIds = (storeHubStores ?? []).map(s => s.store_id);

  const inventoryByProduct = new Map();
  const trackMap = new Map(shProducts.map(p => [p.id, p.trackStockLevel]));

  if (storeIds.length > 0) {
    console.log(`\nFetching inventory for stores: ${storeIds.join(', ')}...`);
    for (const sid of storeIds) {
      try {
        const inv = await storehubFetch(`/inventory/${sid}`);
        console.log(`  Store ${sid}: ${inv.length} records`);
        for (const item of inv) {
          inventoryByProduct.set(item.productId, (inventoryByProduct.get(item.productId) ?? 0) + item.quantityOnHand);
        }
      } catch (e) {
        console.warn(`  Warning: inventory for ${sid} failed (${e.message}) — all untracked treated as available`);
      }
    }
  }

  // Map top-level StoreHub products → Supabase rows (live schema)
  const topLevel = shProducts.filter(p => !p.parentProductId && p.category);
  console.log(`\nMapping ${topLevel.length} top-level products...`);

  const productRows = topLevel.map(p => {
    const prev = existingMap.get(p.id);
    const catSlug = slugify(p.category);

    // Map variantGroups → modifiers array (same shape as loyalty modifiers)
    const modifiers = (p.variantGroups ?? []).map(vg => ({
      id: vg.id,
      name: vg.name,
      multiSelect: MULTI_SELECT.has(vg.name.toLowerCase()),
      options: vg.options.map(opt => ({
        id: opt.id,
        label: opt.optionValue,
        priceDelta: opt.priceDifference,
        isDefault: opt.isDefault ?? false,
      })),
    }));

    const is_available = trackMap.get(p.id)
      ? (inventoryByProduct.get(p.id) ?? 0) > 0
      : true;

    return {
      id: p.id,
      brand_id: BRAND_ID,
      category: catSlug,          // text slug, not FK
      name: p.name,
      description: '',
      price: p.unitPrice,          // RM (not sen)
      image_url: prev?.image_url ?? '',
      is_available,
      is_featured: prev?.is_featured ?? false,
      modifiers,
    };
  });

  console.log(`\nUpserting ${productRows.length} products...`);
  const { error: prodError } = await supabase
    .from('products')
    .upsert(productRows, { onConflict: 'id' });
  if (prodError) throw new Error(`Product upsert: ${prodError.message}`);

  console.log('\n✅ Sync complete!');
  console.log(`   Categories: ${categoryRows.length}`);
  console.log(`   Products:   ${productRows.length}`);

  console.log('\nSample products:');
  productRows.slice(0, 8).forEach(p => {
    console.log(`  [${p.category}] ${p.name} — RM${p.price.toFixed(2)} (available: ${p.is_available})`);
  });
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err.message);
  process.exit(1);
});
