/**
 * Restore Cloudinary image_url values to Supabase products table.
 *
 * What happened: The sync-storehub route (before commit 4958cb2) used the
 * wrong schema column names (image vs image_url). When today's fix ran the
 * sync with the corrected schema, it could not find existing image_url values
 * (brand_id filter returned no matches or image_url was already blank), so it
 * upserted all products with image_url: "".
 *
 * Fix: Pull all images from Cloudinary, match by product ID, update image_url.
 *
 * Usage: node scripts/restore-image-urls.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const CLOUDINARY_CLOUD = 'dxxzt7k6i';
const CLOUDINARY_API_KEY = '657996329467423';
const CLOUDINARY_API_SECRET = 'pt5FZsyXdPKU1KPsNmJAPlGc2zs';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function listCloudinaryImages() {
  const auth = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/resources/image/upload?prefix=celsius-coffee%2Fproducts&max_results=500`;

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Cloudinary API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log('Fetching images from Cloudinary...');
  const data = await listCloudinaryImages();
  const resources = data.resources ?? [];
  console.log(`  Found ${resources.length} images in Cloudinary`);

  // Build productId → secure_url map
  // public_id format: "celsius-coffee/products/{id}" or "celsius-coffee/products/celsius-coffee/products/{id}"
  const imageMap = new Map();
  for (const r of resources) {
    const parts = r.public_id.split('/');
    const productId = parts[parts.length - 1]; // always the last segment
    imageMap.set(productId, r.secure_url);
  }
  console.log(`  Mapped ${imageMap.size} unique product IDs\n`);

  // Fetch current products from Supabase
  const { data: products, error: fetchError } = await supabase
    .from('products')
    .select('id, name, image_url');

  if (fetchError) throw new Error(`Supabase fetch error: ${fetchError.message}`);
  console.log(`Checking ${products.length} products in Supabase...\n`);

  let updated = 0, skipped = 0, notFound = 0;

  for (const product of products) {
    const cloudinaryUrl = imageMap.get(product.id);

    if (!cloudinaryUrl) {
      console.log(`  ⚠  No Cloudinary image for: ${product.name} (${product.id})`);
      notFound++;
      continue;
    }

    if (product.image_url === cloudinaryUrl) {
      skipped++;
      continue; // already correct
    }

    const { error: updateError } = await supabase
      .from('products')
      .update({ image_url: cloudinaryUrl })
      .eq('id', product.id);

    if (updateError) {
      console.error(`  ✗ Failed to update ${product.name}: ${updateError.message}`);
    } else {
      console.log(`  ✓ ${product.name}`);
      updated++;
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log(`✅ Restore complete!`);
  console.log(`   Updated:   ${updated}`);
  console.log(`   Skipped (already correct): ${skipped}`);
  console.log(`   No image found: ${notFound}`);
}

main().catch(err => {
  console.error('\n❌ Restore failed:', err.message);
  process.exit(1);
});
