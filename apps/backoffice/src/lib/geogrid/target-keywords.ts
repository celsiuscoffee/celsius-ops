/**
 * Curated target-keyword set for the local-rank geogrid.
 *
 * Ranked from REAL demand — the Google Ads Smart-campaign search-terms report
 * across the three trading outlets (clicks/spend, pulled 2026-06) — plus an
 * expansion of ownable category / menu / geo terms the report didn't surface.
 *
 * Only ORGANICALLY OWNABLE terms live here. Competitor brand names (luckin, zus,
 * starbucks, kopi kenangan, coffee bean…) are deliberately excluded: a cafe
 * cannot out-rank a rival's own Business Profile for that rival's brand, so no
 * relevance lever moves them — they stay a paid-ads play. See
 * docs/design/gbp-profile-optimizer.md for the relevance-vs-prominence split.
 *
 * `clicks` carries the demand weight (persisted to GeoGridKeyword.impressions);
 * `lever` is the non-review action that actually wins the term:
 *   - "category": GBP primary/additional category (the strongest relevance signal)
 *   - "menu":     surface the item as a Service/Product (+ description)
 *   - "geo":      the place name in the business description + accurate address
 */

export type KeywordLever = "category" | "menu" | "geo";
export type TargetKeyword = { keyword: string; clicks: number; lever: KeywordLever };

// Resolve by the searcher's location, so every outlet competes locally for these.
// Proven-demand terms (clicks > 0) first; expansion discovery terms (clicks 0) after.
export const SHARED_KEYWORDS: TargetKeyword[] = [
  // ── Proven demand (Google Ads search terms, summed across outlets) ──
  { keyword: "cafe near me", clicks: 22628, lever: "category" },
  { keyword: "coffee near me", clicks: 11535, lever: "category" },
  { keyword: "coffee shop near me", clicks: 2082, lever: "category" },
  { keyword: "coffee", clicks: 2307, lever: "category" },
  { keyword: "cafe", clicks: 1877, lever: "category" },
  { keyword: "cafes near me", clicks: 555, lever: "category" },
  { keyword: "breakfast near me", clicks: 2038, lever: "menu" },
  { keyword: "dessert near me", clicks: 600, lever: "menu" },
  { keyword: "kopitiam near me", clicks: 595, lever: "category" },
  { keyword: "restaurants near me", clicks: 3200, lever: "category" }, // needs the Restaurant 2nd category
  // ── Expansion (no ads data yet, but high-intent + ownable for a cafe) ──
  { keyword: "best coffee near me", clicks: 0, lever: "category" },
  { keyword: "specialty coffee near me", clicks: 0, lever: "category" },
  { keyword: "latte near me", clicks: 0, lever: "menu" },
  { keyword: "matcha near me", clicks: 0, lever: "menu" },
  { keyword: "brunch near me", clicks: 0, lever: "menu" },
  { keyword: "study cafe near me", clicks: 0, lever: "category" },
];

// Geo terms are outlet-specific — matched against the outlet name.
export const OUTLET_GEO_KEYWORDS: { match: RegExp; area: string; keywords: TargetKeyword[] }[] = [
  {
    match: /shah alam/i,
    area: "Shah Alam",
    keywords: [
      { keyword: "cafe shah alam", clicks: 1409, lever: "geo" },
      { keyword: "cafe seksyen 13", clicks: 506, lever: "geo" },
      { keyword: "setia alam cafe", clicks: 388, lever: "geo" },
      { keyword: "cafe seksyen 7", clicks: 341, lever: "geo" },
      { keyword: "coffee shah alam", clicks: 0, lever: "geo" },
      { keyword: "breakfast shah alam", clicks: 0, lever: "geo" },
    ],
  },
  {
    match: /putrajaya/i,
    area: "Putrajaya",
    keywords: [
      { keyword: "cafe putrajaya", clicks: 948, lever: "geo" },
      { keyword: "coffee putrajaya", clicks: 0, lever: "geo" },
      { keyword: "breakfast putrajaya", clicks: 0, lever: "geo" },
      { keyword: "cafe presint putrajaya", clicks: 0, lever: "geo" },
    ],
  },
  {
    // Tamarind = Tamarind Square, Cyberjaya (the screenshot-2 outlet).
    match: /tamarind|cyberjaya/i,
    area: "Cyberjaya (Tamarind)",
    keywords: [
      { keyword: "cafe cyberjaya", clicks: 202, lever: "geo" },
      { keyword: "coffee cyberjaya", clicks: 0, lever: "geo" },
      { keyword: "cafe tamarind square", clicks: 0, lever: "geo" },
      { keyword: "breakfast cyberjaya", clicks: 0, lever: "geo" },
    ],
  },
  {
    // No ads data (Nilai is effectively invisible today) — seed the basics so the
    // loop has terms to chase once the profile + first reviews are live.
    match: /nilai/i,
    area: "Nilai",
    keywords: [
      { keyword: "cafe nilai", clicks: 0, lever: "geo" },
      { keyword: "coffee nilai", clicks: 0, lever: "geo" },
      { keyword: "cafe near usim", clicks: 0, lever: "geo" },
    ],
  },
];

// Major chains we compete with but can't out-rank for their own brand. Matched
// as whole words (so "kopitiam" is NOT caught by a "kopi"-style token, and "zus"
// won't match inside another word).
export const COMPETITOR_BRANDS = [
  "luckin",
  "zus",
  "starbucks",
  "kenangan",
  "coffee bean",
  "tealive",
  "gigi coffee",
  "bask bear",
  "richiamo",
  "san francisco coffee",
];

/** True if the keyword targets a competitor's brand (un-winnable organically). */
export function isCompetitorBrand(keyword: string): boolean {
  const k = keyword.toLowerCase();
  return COMPETITOR_BRANDS.some((b) => new RegExp(`\\b${b}\\b`).test(k));
}

/**
 * The ranked, de-duped, competitor-filtered keyword set for one outlet:
 * shared category/menu terms + that outlet's geo terms, sorted by demand.
 */
export function targetKeywordsForOutlet(outletName: string): TargetKeyword[] {
  const geo = OUTLET_GEO_KEYWORDS.find((g) => g.match.test(outletName))?.keywords ?? [];
  const seen = new Set<string>();
  return [...SHARED_KEYWORDS, ...geo]
    .filter((t) => !isCompetitorBrand(t.keyword))
    .filter((t) => (seen.has(t.keyword) ? false : (seen.add(t.keyword), true)))
    .sort((a, b) => b.clicks - a.clicks);
}
