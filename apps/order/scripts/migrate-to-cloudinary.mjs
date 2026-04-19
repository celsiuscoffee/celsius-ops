import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";
import { readFileSync } from "fs";

// ── Credentials ─────────────────────────────────────────────────────────────
const env = readFileSync(".env.local", "utf8");
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1].trim();
const SUPABASE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1].trim();

cloudinary.config({
  cloud_name: env.match(/CLOUDINARY_CLOUD_NAME=(.+)/)?.[1].trim(),
  api_key:    env.match(/CLOUDINARY_API_KEY=(.+)/)?.[1].trim(),
  api_secret: env.match(/CLOUDINARY_API_SECRET=(.+)/)?.[1].trim(),
  secure:     true,
});

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function uploadToCloudinary(supabaseUrl, productId, productName) {
  try {
    const result = await cloudinary.uploader.upload(supabaseUrl, {
      public_id:    `celsius-coffee/products/${productId}`,
      overwrite:    true,
      folder:       "celsius-coffee/products",
      // Auto optimize: format + quality
      transformation: [{ quality: "auto:good", fetch_format: "auto" }],
      tags:         ["celsius-coffee", "product"],
    });
    return result.secure_url;
  } catch (err) {
    console.error(`  ✗ Failed to upload ${productName}:`, err.message);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const { data: products, error } = await sb
  .from("products")
  .select("id,name,image")
  .not("image", "is", null)
  .neq("image", "");

if (error) { console.error("Supabase fetch error:", error); process.exit(1); }

const withImages = products.filter(p => p.image?.includes("supabase"));
console.log(`\n🚀 Migrating ${withImages.length} product images to Cloudinary...\n`);

let success = 0, failed = 0;

for (const product of withImages) {
  process.stdout.write(`  ↑ ${product.name}... `);

  const cloudinaryUrl = await uploadToCloudinary(product.image, product.id, product.name);

  if (!cloudinaryUrl) { failed++; continue; }

  // Update Supabase with new Cloudinary URL
  const { error: updateError } = await sb
    .from("products")
    .update({ image: cloudinaryUrl })
    .eq("id", product.id);

  if (updateError) {
    console.log(`✗ DB update failed: ${updateError.message}`);
    failed++;
  } else {
    console.log(`✓ ${cloudinaryUrl.split("/").pop()}`);
    success++;
  }

  // Rate limit: 2 req/sec to stay within Cloudinary free tier
  await sleep(500);
}

console.log(`\n✅ Done! ${success} migrated, ${failed} failed.\n`);
