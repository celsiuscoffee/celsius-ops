import { createHash } from "node:crypto";

// RFC 4122 URL namespace UUID: 6ba7b811-9dad-11d1-80b4-00c04fd430c8
const URL_NAMESPACE_BYTES = Buffer.from([
  0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1,
  0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
]);

/**
 * Deterministic UUID v5 for the voucher_templates mirror of a legacy
 * `rewards` catalog row.
 *
 * Mirrors the Postgres expression used in the Commit-1 migration
 * (docs/migrations/rewards-canonical-shape-commit1.sql):
 *
 *     uuid_generate_v5(uuid_ns_url(), 'rewards-catalog:' || rewards.id)
 *
 * So a given catalog reward_id (e.g. "reward-1") always resolves to the
 * same voucher_templates row id on both the DB side and here. Bean-Shop
 * mint paths that still read the `rewards` table use this to stamp
 * issued_rewards.voucher_template_id, so every freshly minted voucher
 * carries its template link even before the catalog table is dropped
 * (Commit 3). Verified against the live mirror rows.
 *
 * node:crypto only — server-side mint paths only. Do not import into a
 * browser bundle.
 */
export function catalogMirrorTemplateId(rewardId: string): string {
  const name = Buffer.from(`rewards-catalog:${rewardId}`, "utf8");
  const hash = createHash("sha1")
    .update(Buffer.concat([URL_NAMESPACE_BYTES, name]))
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
