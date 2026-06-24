/**
 * Geogrid keyword + grid configuration, per outlet.
 *
 * Suggested keyword sets (2026-06-24). Grounded in each outlet's real locale —
 * NOT pulled from Google Ads yet: the Ads dev token is Explorer-tier (no
 * production data), so `ads_keyword_metric` is effectively empty. Once the Ads
 * token reaches Basic access, RECONCILE these against the keywords that
 * actually convert (highest impressions/clicks in `ads_keyword_metric`) and
 * promote the winners here.
 *
 * Two kinds of keyword, by design (see docs/design/gbp-geogrid-rank-loop.md):
 *   - "generic"  — high-intent "near me" terms with no place name. THIS is the
 *                  radius game: do we still surface when the searcher is far from
 *                  the café? Maximizing #1-reach is mostly about these.
 *   - "locale"   — town/landmark terms ("cafe nilai"). Relevance coverage — do
 *                  we own our own town's name in the pack.
 *
 * Cost dials (Places Text Search is billed per call):
 *   calls/sweep = gridSize² × keywords × outlets.
 *   Defaults below: 9×9 × 5 × 4 = 1,620 calls/sweep (≈ the doc's ~$200/mo at
 *   weekly cadence). Trim keywords or shrink the grid to cut cost.
 */

export type GeoKeywordKind = "generic" | "locale";

export type GeoKeyword = {
  text: string;
  kind: GeoKeywordKind;
};

export type OutletGeoConfig = {
  /** Lowercased substring matched against Outlet.name (same trick the reviews dashboard uses). */
  match: string;
  /** N for an N×N grid; odd so the centre cell sits on the outlet. */
  gridSize: number;
  /** Kilometres between adjacent cells. gridSize × spacing ≈ the diameter you can "see". */
  spacingKm: number;
  /** Radius (m) of the Places locationBias circle at each cell — how tightly each query localises. */
  biasRadiusM: number;
  keywords: GeoKeyword[];
};

// Brand token used to spot our own listing in Places results when a place_id
// isn't configured on the outlet's ReviewSettings. Case-insensitive substring.
export const BRAND_MATCH = "celsius";

// Shared high-intent "near me" base — the radius game. Same across outlets so
// the #1-reach numbers are comparable between them.
const GENERIC: GeoKeyword[] = [
  { text: "coffee near me", kind: "generic" },
  { text: "cafe near me", kind: "generic" },
  { text: "study cafe", kind: "generic" }, // big driver in MY (students / remote work)
];

const g = (gridSize: number, spacingKm: number, biasRadiusM: number): Omit<OutletGeoConfig, "match" | "keywords"> => ({
  gridSize,
  spacingKm,
  biasRadiusM,
});

export const OUTLET_GEO_CONFIGS: OutletGeoConfig[] = [
  {
    match: "putrajaya",
    ...g(9, 1.5, 1800), // IOI City Mall pulls a wide catchment (Cyberjaya/Bangi/Kajang) → wider grid
    keywords: [
      ...GENERIC,
      { text: "cafe putrajaya", kind: "locale" },
      { text: "cafe ioi city mall", kind: "locale" },
      // extras to consider once cost is understood:
      // { text: "coffee putrajaya", kind: "locale" },
      // { text: "kopi putrajaya", kind: "locale" },
    ],
  },
  {
    match: "shah alam",
    ...g(9, 1.2, 1500),
    keywords: [
      ...GENERIC,
      { text: "cafe shah alam", kind: "locale" },
      { text: "cafe seksyen 13 shah alam", kind: "locale" },
      // { text: "coffee shah alam", kind: "locale" },
      // { text: "kopi shah alam", kind: "locale" },
    ],
  },
  {
    match: "tamarind", // Tamarind Square, Cyberjaya
    ...g(9, 1.2, 1500),
    keywords: [
      ...GENERIC,
      { text: "cafe cyberjaya", kind: "locale" },
      { text: "cafe tamarind square", kind: "locale" },
      // { text: "coffee cyberjaya", kind: "locale" },
      // { text: "study cafe cyberjaya", kind: "locale" },
    ],
  },
  {
    match: "nilai",
    ...g(9, 1.2, 1500),
    keywords: [
      ...GENERIC,
      { text: "cafe nilai", kind: "locale" },
      { text: "cafe near usim", kind: "locale" }, // USIM + INTI campuses anchor demand
      // { text: "coffee nilai", kind: "locale" },
      // { text: "kopi nilai", kind: "locale" },
    ],
  },
];

/** Find the geo config for an outlet by name (substring match). */
export function configForOutlet(outletName: string): OutletGeoConfig | undefined {
  const lower = outletName.toLowerCase();
  return OUTLET_GEO_CONFIGS.find((c) => lower.includes(c.match));
}
