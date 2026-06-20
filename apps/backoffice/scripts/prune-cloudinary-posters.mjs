#!/usr/bin/env node
/**
 * Delete orphaned Cloudinary poster assets — DRY RUN by default.
 *
 * An asset is deleted only if NO splash_posters row references it (across
 * image_url, original_bg_url and composer_state.bgUrl), so posters created
 * via duplicate() that share an asset are never broken. Scoped strictly to
 * the celsius-coffee/posters/ prefix — product images are never touched.
 *
 * Usage:
 *   node scripts/prune-cloudinary-posters.mjs            # DRY RUN (no deletes)
 *   node scripts/prune-cloudinary-posters.mjs --apply    # actually delete
 *
 * Run the audit first to see the number:
 *   node scripts/audit-cloudinary-posters.mjs
 */
import {
  loadEnv,
  configureCloudinary,
  getSupabase,
  listPosterAssets,
  loadReferencedUrls,
  partitionOrphans,
  sumBytes,
  formatBytes,
  POSTER_PREFIX,
} from "./lib/cloudinary-posters.mjs";

const apply = process.argv.includes("--apply");

loadEnv();
const cloudinary = configureCloudinary();
const sb = getSupabase();

console.log(`Scanning for orphaned poster assets… (${apply ? "APPLY" : "DRY RUN"})\n`);

const [assets, refs] = await Promise.all([
  listPosterAssets(),
  loadReferencedUrls(sb),
]);

// Circuit breaker: if Cloudinary has poster assets but Supabase returned
// zero references, the query almost certainly failed/misconfigured. Refuse
// to treat everything as an orphan and mass-delete.
if (assets.length > 0 && refs.length === 0) {
  console.error(
    `Aborting: found ${assets.length} poster assets but 0 references in splash_posters.\n` +
      "That looks like a failed/misconfigured Supabase query, not a real cleanup.",
  );
  process.exit(1);
}

const { orphans } = partitionOrphans(assets, refs);
const orphanBytes = sumBytes(orphans);

if (orphans.length === 0) {
  console.log("No orphaned poster assets. Nothing to do. 🎉");
  process.exit(0);
}

console.log(`${orphans.length} orphaned poster assets — ${formatBytes(orphanBytes)} reclaimable.\n`);

// Defence in depth: never delete anything outside the posters prefix, even
// if the listing logic ever changes upstream.
const ids = orphans.map((a) => a.publicId);
const outOfScope = ids.filter((id) => !id.startsWith(`${POSTER_PREFIX}/`));
if (outOfScope.length > 0) {
  console.error("Refusing to run — found assets outside the posters prefix:");
  for (const id of outOfScope.slice(0, 5)) console.error(`  ${id}`);
  process.exit(1);
}

if (!apply) {
  console.log("DRY RUN — nothing deleted. First 20 that WOULD be deleted:");
  for (const a of orphans.slice(0, 20)) {
    console.log(`  ${a.publicId}  (${formatBytes(a.bytes)})`);
  }
  if (orphans.length > 20) console.log(`  …and ${orphans.length - 20} more.`);
  console.log("\nRe-run with --apply to delete them.");
  process.exit(0);
}

// Cloudinary's delete_resources caps at 100 public_ids per call.
let deleted = 0;
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const res = await cloudinary.api.delete_resources(chunk, {
    resource_type: "image",
    type:          "upload",
    invalidate:    true, // purge CDN caches for the removed assets
  });
  deleted += Object.values(res.deleted ?? {}).filter((v) => v === "deleted").length;
  console.log(`  deleted ${deleted}/${ids.length}…`);
}

console.log(`\n✅ Done. Deleted ${deleted} orphaned poster assets (~${formatBytes(orphanBytes)} reclaimed).`);
