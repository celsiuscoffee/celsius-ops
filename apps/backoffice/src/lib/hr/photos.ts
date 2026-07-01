// Signed-URL access for attendance selfies.
//
// hr-photos holds staff clock-in/out selfies (biometric + GPS-correlated). The
// bucket must be PRIVATE — so instead of a public URL we mint a short-lived signed
// URL at read time. Handles BOTH storage formats: new rows store the object PATH,
// legacy rows stored a full public URL (we strip back to the path before signing).
import { hrSupabaseAdmin } from "./supabase";

const BUCKET = "hr-photos";
const MARKER = "/hr-photos/";
const SIGNED_TTL_SECONDS = 60 * 30; // 30 min — long enough for a review session

/** Reduce a stored value (path OR legacy public URL) to the object path. */
function toObjectPath(stored: string): string {
  const i = stored.indexOf(MARKER);
  return i >= 0 ? stored.slice(i + MARKER.length) : stored;
}

/**
 * Batch-sign attendance photo values. Returns a Map keyed by the ORIGINAL stored
 * value → signed URL (so callers can look up by whatever they hold). Nulls and
 * un-signable paths are simply absent from the map (caller renders no photo).
 */
export async function signAttendancePhotos(values: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const originals = Array.from(new Set(values.filter((v): v is string => !!v)));
  if (originals.length === 0) return out;

  const pathToOriginals = new Map<string, string[]>();
  for (const original of originals) {
    const path = toObjectPath(original);
    const list = pathToOriginals.get(path) ?? [];
    list.push(original);
    pathToOriginals.set(path, list);
  }

  const paths = Array.from(pathToOriginals.keys());
  const { data, error } = await hrSupabaseAdmin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL_SECONDS);
  if (error || !data) return out;

  for (const row of data) {
    if (!row.signedUrl || row.error || !row.path) continue;
    for (const original of pathToOriginals.get(row.path) ?? []) out.set(original, row.signedUrl);
  }
  return out;
}

/** Sign a single stored value (path or legacy URL). Null-safe. */
export async function signAttendancePhoto(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const { data } = await hrSupabaseAdmin.storage.from(BUCKET).createSignedUrl(toObjectPath(stored), SIGNED_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
