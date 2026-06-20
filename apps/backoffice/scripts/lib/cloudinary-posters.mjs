/**
 * Shared logic for the Cloudinary poster storage tools.
 *
 * Posters are the one unbounded source of Cloudinary growth: every upload,
 * Re-crop and AI-compose save mints a fresh `celsius-coffee/posters/{uuid}`
 * asset, and nothing ever deletes the old one (DELETE only removes the
 * Supabase row). Over time orphaned poster assets pile up and eat the plan.
 *
 * A poster row can reference a Cloudinary asset in three places:
 *   - image_url        (the live, displayed image)
 *   - original_bg_url  (clean pre-flatten bg, anchor for AI re-compose)
 *   - composer_state.bgUrl
 *
 * `duplicate()` copies all three, so MULTIPLE rows can point at the SAME
 * asset. That's why deletion has to be reference-aware: an asset is only an
 * orphan when NO row references it. Both the audit and prune tools build on
 * the helpers here so they share one definition of "orphan".
 */
import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKOFFICE_ROOT = resolve(HERE, "..", "..");

// Deletes are scoped to this prefix and NOTHING else. Product images live
// under celsius-coffee/products/ and are referenced by the products table,
// not splash_posters — sweeping them here would delete in-use assets.
export const POSTER_PREFIX = "celsius-coffee/posters";

// Minimal .env.local loader — backoffice has no dotenv dep. A real
// process.env value always wins, so shell / CI exports override the file.
export function loadEnv() {
  try {
    const raw = readFileSync(resolve(BACKOFFICE_ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // No .env.local — rely entirely on the process environment.
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Set it in apps/backoffice/.env.local or export it.`,
    );
  }
  return v;
}

export function configureCloudinary() {
  cloudinary.config({
    cloud_name: requireEnv("CLOUDINARY_CLOUD_NAME"),
    api_key:    requireEnv("CLOUDINARY_API_KEY"),
    api_secret: requireEnv("CLOUDINARY_API_SECRET"),
    secure:     true,
  });
  return cloudinary;
}

export function getSupabase() {
  return createClient(
    requireEnv("NEXT_PUBLIC_LOYALTY_SUPABASE_URL"),
    requireEnv("LOYALTY_SUPABASE_SERVICE_ROLE_KEY"),
  );
}

// List every Cloudinary asset under the posters prefix (paginated — the
// Admin API caps a page at 500 results).
export async function listPosterAssets() {
  const assets = [];
  let nextCursor;
  do {
    const res = await cloudinary.api.resources({
      resource_type: "image",
      type:          "upload",
      prefix:        POSTER_PREFIX,
      max_results:   500,
      next_cursor:   nextCursor,
    });
    for (const r of res.resources ?? []) {
      assets.push({
        publicId:  r.public_id,
        bytes:     r.bytes ?? 0,
        createdAt: r.created_at ?? null,
        url:       r.secure_url ?? "",
      });
    }
    nextCursor = res.next_cursor;
  } while (nextCursor);
  return assets;
}

// Every Cloudinary URL referenced by a poster row (see file header).
export async function loadReferencedUrls(sb) {
  const { data, error } = await sb
    .from("splash_posters")
    .select("image_url, original_bg_url, composer_state");
  if (error) throw new Error(`Supabase fetch error: ${error.message}`);

  const refs = [];
  for (const row of data ?? []) {
    if (row.image_url) refs.push(row.image_url);
    if (row.original_bg_url) refs.push(row.original_bg_url);
    const cs = row.composer_state;
    if (cs && typeof cs === "object" && typeof cs.bgUrl === "string") {
      refs.push(cs.bgUrl);
    }
  }
  return refs;
}

// Split assets into referenced vs orphaned. An asset counts as referenced
// when its public_id appears anywhere in any referenced URL — robust
// against version prefixes, inline transformations and cache-bust query
// strings, all of which leave the public_id intact in the URL path.
export function partitionOrphans(assets, referencedUrls) {
  const haystack = referencedUrls.join("\n");
  const referenced = [];
  const orphans = [];
  for (const a of assets) {
    if (haystack.includes(a.publicId)) referenced.push(a);
    else orphans.push(a);
  }
  return { referenced, orphans };
}

export const sumBytes = (xs) => xs.reduce((t, a) => t + a.bytes, 0);

export function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i ? 2 : 0)} ${units[i]}`;
}
