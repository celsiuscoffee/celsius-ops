import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { cronRoute } from "@/lib/cron-monitor";
import {
  listPosterAssets,
  loadReferencedUrls,
  partitionOrphans,
  selectDeletableOrphans,
  referencesLookSafe,
  POSTER_PREFIX,
} from "@/lib/pickup/cloudinary-posters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/prune-poster-assets  (Vercel Cron, weekly)
 *
 * Reclaims orphaned Cloudinary poster assets. Every poster upload, Re-crop
 * and AI-compose save mints a fresh celsius-coffee/posters/{uuid} asset and
 * nothing removes the old one (DELETE drops only the Supabase row), so dead
 * assets accumulate and overflow the plan. This sweep deletes assets that no
 * splash_posters row references (across image_url, original_bg_url and
 * composer_state.bgUrl), so posters sharing an image via duplicate() are
 * never broken.
 *
 * Safety:
 *   - Scoped strictly to the posters prefix — product images are untouched.
 *   - GRACE_DAYS window: the upload flow stores the asset in Cloudinary
 *     before the operator saves the row, so a fresh unreferenced asset may
 *     be mid-edit, not abandoned. We only delete orphans older than that.
 *   - Idempotent: a deleted asset stops appearing, so re-runs are no-ops.
 */
const GRACE_DAYS = 7;

async function runPrunePosterAssets() {
  // Fail-closed if Cloudinary isn't configured, rather than half-running.
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return NextResponse.json({ error: "Cloudinary not configured" }, { status: 500 });
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  const supabase = getSupabaseAdmin();

  const [assets, refs] = await Promise.all([
    listPosterAssets(cloudinary),
    loadReferencedUrls(supabase),
  ]);
  // Circuit breaker: never mass-delete when the reference query came back
  // empty while Cloudinary has assets — that signals a failed/misconfigured
  // query, not that every poster is genuinely orphaned.
  if (!referencesLookSafe(assets.length, refs.length)) {
    return NextResponse.json(
      { error: "Aborting: poster assets exist but zero references loaded" },
      { status: 500 },
    );
  }

  const { orphans } = partitionOrphans(assets, refs);
  const deletable = selectDeletableOrphans(orphans, GRACE_DAYS * 86_400_000);

  // Defence in depth: never touch anything outside the posters prefix, even
  // if the listing logic ever changes upstream.
  const bytesById = new Map(deletable.map((a) => [a.publicId, a.bytes]));
  const ids = deletable
    .map((a) => a.publicId)
    .filter((id) => id.startsWith(`${POSTER_PREFIX}/`));

  let deleted = 0;
  let reclaimedBytes = 0;
  // Cloudinary's delete_resources caps at 100 public_ids per call.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await cloudinary.api.delete_resources(chunk, {
      resource_type: "image",
      type: "upload",
      invalidate: true, // purge CDN caches for the removed assets
    });
    for (const [id, status] of Object.entries(res.deleted ?? {})) {
      if (status === "deleted") {
        deleted += 1;
        reclaimedBytes += bytesById.get(id) ?? 0;
      }
    }
  }

  const summary = {
    scanned: assets.length,
    orphans: orphans.length,
    skippedWithinGrace: orphans.length - deletable.length,
    deleted,
    reclaimedBytes,
    graceDays: GRACE_DAYS,
  };
  if (deleted > 0) {
    console.log("[cron/prune-poster-assets]", JSON.stringify(summary));
  }
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = cronRoute("prune-poster-assets", runPrunePosterAssets);
