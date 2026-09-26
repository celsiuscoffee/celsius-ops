/**
 * Helpers for the few places that build a PostgREST `.or(...)` filter string
 * from request input. PostgREST parses `,` `(` `)` and `.` inside that string
 * as grammar, so an unescaped value lets a caller append their own filter
 * (`?search=x,id.not.is.null` turned a member search into "every member").
 * Prefer `.eq()` / `.ilike()` builders where the query allows; when an OR
 * across columns is genuinely needed, pass values through these first.
 */

/** A free-text search term for `col.ilike.%term%`: grammar characters and
 *  quotes removed, length capped. `%` / `_` are left in — they only widen a
 *  wildcard search the caller already asked for. */
export function sanitizeIlikeTerm(raw: string | null | undefined, max = 64): string {
  return (raw ?? "").replace(/[,()"'\\]/g, "").trim().slice(0, max);
}

/** True for identifiers safe to interpolate as a filter value: cuid/uuid/slug
 *  shaped, no grammar characters. */
export function isSafeFilterIdent(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw);
}
