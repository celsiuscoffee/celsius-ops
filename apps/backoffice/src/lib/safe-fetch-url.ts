/**
 * Guard for server-side fetches of a caller-supplied URL.
 *
 * Several routes take a document/image URL from the request and fetch it on
 * the server (PDF split, invoice extract, AI poster background). Without a
 * host check that is a plain SSRF: a logged-in user could point them at the
 * cloud metadata endpoint or an internal service and, in the split-pop case,
 * have the response re-uploaded to a public bucket. Every legitimate caller
 * passes a URL from our own Supabase storage or Cloudinary, so allow exactly
 * those.
 */

const ALLOWED_HOST_SUFFIXES = [".supabase.co", ".supabase.in", ".cloudinary.com"];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowedExactHosts(): Set<string> {
  return new Set(
    [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL,
      process.env.LEGACY_INVENTORY_SUPABASE_URL,
    ]
      .map(hostOf)
      .filter((h): h is string => !!h),
  );
}

export class DisallowedFetchUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisallowedFetchUrlError";
  }
}

/** Returns the parsed URL when it may be fetched server-side; throws
 *  DisallowedFetchUrlError otherwise. https only, allow-listed hosts only. */
export function assertAllowedFetchUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DisallowedFetchUrlError("Invalid URL");
  }
  if (u.protocol !== "https:") {
    throw new DisallowedFetchUrlError("Only https URLs can be fetched");
  }
  const host = u.hostname.toLowerCase();
  if (allowedExactHosts().has(host) || ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return u;
  }
  throw new DisallowedFetchUrlError(`Refusing to fetch from ${host}: not a storage host we use`);
}

export function isAllowedFetchUrl(raw: string): boolean {
  try {
    assertAllowedFetchUrl(raw);
    return true;
  } catch {
    return false;
  }
}
