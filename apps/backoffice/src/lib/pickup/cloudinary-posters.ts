/**
 * Orphan-detection for Cloudinary poster assets — the canonical logic used
 * by the prune cron (api/cron/prune-poster-assets).
 *
 * Posters are the one unbounded source of Cloudinary growth: every upload,
 * Re-crop and AI-compose save mints a fresh `celsius-coffee/posters/{uuid}`
 * asset, and nothing removes the old one (DELETE drops only the Supabase
 * row). A poster row can reference an asset in THREE places:
 *   - image_url        (the live, displayed image)
 *   - original_bg_url  (clean pre-flatten bg, anchor for AI re-compose)
 *   - composer_state.bgUrl
 *
 * `duplicate()` copies all three, so multiple rows can share one asset —
 * an asset is therefore only an orphan when NO row references it.
 *
 * NOTE: the manual CLI tools in apps/backoffice/scripts/lib/cloudinary-posters.mjs
 * mirror this logic. If you add a Cloudinary URL field to splash_posters,
 * update BOTH or a sweep could delete an in-use asset.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Deletes are scoped to this prefix and nothing else. Product images live
// under celsius-coffee/products/ and are referenced by the products table,
// not splash_posters — sweeping them here would delete in-use assets.
export const POSTER_PREFIX = "celsius-coffee/posters";

export type PosterAsset = {
  publicId: string;
  bytes: number;
  createdAt: string | null;
};

// Minimal shape of the Cloudinary v2 Admin API we depend on — keeps this
// module unit-testable without importing the SDK.
export interface CloudinaryResourceLister {
  api: {
    resources(options: Record<string, unknown>): Promise<{
      resources?: Array<{ public_id: string; bytes?: number; created_at?: string }>;
      next_cursor?: string;
    }>;
  };
}

// List every Cloudinary asset under the posters prefix (paginated — the
// Admin API caps a page at 500 results).
export async function listPosterAssets(
  cloudinary: CloudinaryResourceLister,
): Promise<PosterAsset[]> {
  const assets: PosterAsset[] = [];
  let nextCursor: string | undefined;
  do {
    const res = await cloudinary.api.resources({
      resource_type: "image",
      type: "upload",
      prefix: POSTER_PREFIX,
      max_results: 500,
      next_cursor: nextCursor,
    });
    for (const r of res.resources ?? []) {
      assets.push({
        publicId: r.public_id,
        bytes: r.bytes ?? 0,
        createdAt: r.created_at ?? null,
      });
    }
    nextCursor = res.next_cursor;
  } while (nextCursor);
  return assets;
}

// Every Cloudinary URL referenced by a poster row (see file header).
export async function loadReferencedUrls(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb
    .from("splash_posters")
    .select("image_url, original_bg_url, composer_state");
  if (error) throw new Error(`Supabase fetch error: ${error.message}`);

  const refs: string[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.image_url === "string") refs.push(row.image_url);
    if (typeof row.original_bg_url === "string") refs.push(row.original_bg_url);
    const cs = row.composer_state;
    if (cs && typeof cs === "object" && typeof (cs as { bgUrl?: unknown }).bgUrl === "string") {
      refs.push((cs as { bgUrl: string }).bgUrl);
    }
  }
  return refs;
}

// Split assets into referenced vs orphaned. An asset counts as referenced
// when its public_id appears anywhere in any referenced URL — robust
// against version prefixes, inline transformations and cache-bust query
// strings, all of which leave the public_id intact in the URL path.
export function partitionOrphans(
  assets: PosterAsset[],
  referencedUrls: string[],
): { referenced: PosterAsset[]; orphans: PosterAsset[] } {
  const haystack = referencedUrls.join("\n");
  const referenced: PosterAsset[] = [];
  const orphans: PosterAsset[] = [];
  for (const a of assets) {
    if (a.publicId && haystack.includes(a.publicId)) referenced.push(a);
    else orphans.push(a);
  }
  return { referenced, orphans };
}

// Orphans younger than the grace window are NOT eligible for automated
// deletion. The poster upload flow stores an image in Cloudinary BEFORE the
// operator clicks Save, so a brand-new asset is briefly unreferenced while
// it's mid-edit — deleting it would destroy an image about to be saved.
// Assets with an unknown/unparseable age are never auto-deleted (conservative).
export function selectDeletableOrphans(
  orphans: PosterAsset[],
  graceMs: number,
  now: number = Date.now(),
): PosterAsset[] {
  return orphans.filter((a) => {
    if (!a.createdAt) return false;
    const created = Date.parse(a.createdAt);
    if (Number.isNaN(created)) return false;
    return now - created >= graceMs;
  });
}
