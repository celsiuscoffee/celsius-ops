#!/usr/bin/env node
/**
 * Read-only audit of Cloudinary poster storage.
 *
 * Reports how many poster assets exist, how many are still referenced by a
 * splash_posters row, and how much storage is reclaimable (orphans). Makes
 * NO changes — safe to run anytime. Use this to get the real number before
 * running prune-cloudinary-posters.mjs.
 *
 * Usage:
 *   node scripts/audit-cloudinary-posters.mjs           # print report
 *   node scripts/audit-cloudinary-posters.mjs --json     # also dump orphan
 *                                                        # list to a JSON file
 *
 * Requires (from apps/backoffice/.env.local or the shell):
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
 *   NEXT_PUBLIC_LOYALTY_SUPABASE_URL, LOYALTY_SUPABASE_SERVICE_ROLE_KEY
 */
import { writeFileSync } from "node:fs";
import {
  loadEnv,
  configureCloudinary,
  getSupabase,
  listPosterAssets,
  loadReferencedUrls,
  partitionOrphans,
  sumBytes,
  formatBytes,
} from "./lib/cloudinary-posters.mjs";

loadEnv();
configureCloudinary();
const sb = getSupabase();

console.log("Scanning Cloudinary posters + Supabase references…\n");

const [assets, refs] = await Promise.all([
  listPosterAssets(),
  loadReferencedUrls(sb),
]);
const { referenced, orphans } = partitionOrphans(assets, refs);

const totalBytes = sumBytes(assets);
const orphanBytes = sumBytes(orphans);

console.log("─────────────────────────────────────────────");
console.log(`Poster assets in Cloudinary : ${assets.length} (${formatBytes(totalBytes)})`);
console.log(`Still referenced            : ${referenced.length} (${formatBytes(sumBytes(referenced))})`);
console.log(`Orphaned (reclaimable)      : ${orphans.length} (${formatBytes(orphanBytes)})`);
if (totalBytes > 0) {
  console.log(`Reclaimable share           : ${((orphanBytes / totalBytes) * 100).toFixed(1)}% of poster storage`);
}
console.log("─────────────────────────────────────────────");

if (orphans.length > 0) {
  const withDates = orphans.filter((a) => a.createdAt);
  if (withDates.length > 0) {
    const sorted = [...withDates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    console.log(`\nOldest orphan: ${sorted[0].createdAt}`);
    console.log(`Newest orphan: ${sorted[sorted.length - 1].createdAt}`);
  }
  console.log("\nSample of orphaned assets (up to 10):");
  for (const a of orphans.slice(0, 10)) {
    console.log(`  ${a.publicId}  (${formatBytes(a.bytes)})`);
  }
  if (orphans.length > 10) console.log(`  …and ${orphans.length - 10} more.`);
  console.log("\nNext step: node scripts/prune-cloudinary-posters.mjs   (dry run, safe)");
} else {
  console.log("\nNo orphaned poster assets — nothing to reclaim. 🎉");
}

if (process.argv.includes("--json")) {
  const out = "cloudinary-orphans.json";
  writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalAssets: assets.length,
        orphanCount: orphans.length,
        reclaimableBytes: orphanBytes,
        orphans: orphans.map((a) => ({ publicId: a.publicId, bytes: a.bytes, createdAt: a.createdAt })),
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote orphan list → ${out}`);
}
