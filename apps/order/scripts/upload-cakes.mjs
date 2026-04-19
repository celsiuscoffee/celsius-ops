/**
 * Upload cake/pastry images to Cloudinary and update Supabase products.
 * Uses raw fetch — no SDK dependencies.
 */
import { readFileSync } from 'fs';

// Required env vars (use .env.local or inline):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !CLOUD || !API_KEY || !API_SECRET) {
  console.error("Missing required env vars. See comment at top of file.");
  process.exit(1);
}

const DIR = '/Users/ammarshahrin/Desktop/CAKES';

const MAPPING = [
  { file: 'CC_MENU 2026 (PASTRIES)_CK - -.png',            productId: '68ad6eac59357c00074fe299', name: 'Burnt Cheesecake' },
  { file: 'CC_MENU 2026 (PASTRIES)_CK - CREPE.png',         productId: '68b1e1185296d20007fa0c4f', name: 'Almond Crepe Cake' },
  { file: 'CC_MENU 2026 (PASTRIES)_CK - MUDSLIDE.png',      productId: '68ad6eac59357c00074fe2a5', name: 'Chocolate Mudslide' },
  { file: 'CC_MENU 2026 (PASTRIES)_CK - PAVLOVA.png',       productId: '68d92fd799cecc0007dafb92', name: 'Mini Pavlova' },
  { file: 'CC_MENU 2026 (PASTRIES)_CR - CLASSIC.png',        productId: '68ad6eac59357c00074fe275', name: 'Classic Croissant' },
  { file: 'CC_MENU 2026 (PASTRIES)_CRS - ALMOND.png',        productId: '68ad6eac59357c00074fe28d', name: 'Almond Croissant' },
  { file: 'CC_MENU 2026 (PASTRIES)_CRS - SALTED EGG.png',    productId: '68ad6eac59357c00074fe281', name: 'Salted Egg Croissant' },
];

async function uploadToCloudinary(filePath, productId) {
  const fileBuffer = readFileSync(filePath);
  const base64 = fileBuffer.toString('base64');
  const dataUri = 'data:image/png;base64,' + base64;

  const form = new URLSearchParams();
  form.append('file', dataUri);
  form.append('public_id', 'celsius-coffee/products/' + productId);
  form.append('overwrite', 'true');

  const auth = Buffer.from(API_KEY + ':' + API_SECRET).toString('base64');
  const res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD + '/image/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Cloudinary ' + res.status + ': ' + txt);
  }
  const data = await res.json();
  return data.secure_url;
}

async function updateSupabase(productId, imageUrl) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/products?id=eq.' + productId,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ image_url: imageUrl }),
    }
  );
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + await res.text());
}

async function main() {
  for (const item of MAPPING) {
    const filePath = DIR + '/' + item.file;
    process.stdout.write(item.name + '... ');
    try {
      const url = await uploadToCloudinary(filePath, item.productId);
      await updateSupabase(item.productId, url);
      console.log('done');
    } catch (err) {
      console.log('FAILED: ' + err.message);
    }
  }
  console.log('\nAll done!');
}

main();
