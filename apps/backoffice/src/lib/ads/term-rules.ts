/**
 * Search-term intent rules for the ads autopilot.
 *
 * Buckets every matched Smart-campaign search term by purchase intent so the
 * autopilot can auto-exclude the clearly-useless spend (owner directive
 * 2026-07-16: no per-term approval). Deliberately conservative:
 *
 *   own_brand        -> auto-exclude (paying for clicks the brand gets free)
 *   non_cafe_food    -> auto-exclude (a "nasi ayam near me" searcher wants
 *                       lunch, not specialty coffee)
 *   competitor_brand -> auto-exclude (owner 2026-07-18, after reviewing the
 *                       live term lists: "lots of unnecessary ones" — no
 *                       conquesting; flip shouldAutoExclude to reverse)
 *   dessert_bakery   -> auto-exclude (owner 2026-07-18, same review)
 *   cafe_intent      -> KEEP (the spend we want)
 *   other            -> KEEP (unknown ≠ useless)
 *
 * Order matters: brand checks run before the cafe whitelist ("zus coffee"
 * contains "coffee"), and the cafe whitelist runs before the food blocklist
 * ("coffee shop food court" stays).
 */

import { isCompetitorBrand } from "@/lib/geogrid/target-keywords";

export type TermIntent =
  | "own_brand"
  | "competitor_brand"
  | "cafe_intent"
  | "dessert_bakery"
  | "non_cafe_food"
  | "other";

// Rival brands seen in the live search-term data that the geogrid competitor
// list may not carry (it tracks map-pack rivals, not every chain we conquest).
const EXTRA_COMPETITOR_BRANDS =
  /\b(zus|kenangan|luckin|tealive|cbtl|coffee bean|starbucks|oriental kopi|nasken|mykori|kopi saigon|kopi satu|gigi coffee|bask bear|richiamo|secret recipe|iffat|chef kecik|hock kee|kopihut|cotti|vinyl cafe|qbistro|hainan kopitiam|temu coffee)\b/;

const CAFE_INTENT =
  /\b(coffee|cafe|cafes|kafe|kopi|kopitiam|latte|matcha|espresso|americano|cappuccino|mocha|brew|breakfast|brunch|croissant|croffle|study|wifi)\b/;

const NON_CAFE_FOOD =
  /\b(restaurant|restaurants|restoran|kedai makan|food|foods|food court|makan|makanan|warung|gerai|lunch|dinner|nasi|ayam|mamak|burger|pizza|steak|seafood|sushi|ramen|noodle|noodles|mee|laksa|satay|tomyam|tom yam|catering|buffet|shawarma|kebab|briyani|biryani)\b|美食/;

const DESSERT_BAKERY =
  /\b(cake|cakes|kek|dessert|desserts|waffle|waffles|donut|doughnut|bakery|pastry|pastries|ice cream|gelato|bingsu|pudding|tart|tarts|brownie|brownies)\b/;

export function classifyTermIntent(term: string): TermIntent {
  const t = term.toLowerCase();
  if (/celsius|celcius/.test(t)) return "own_brand";
  if (isCompetitorBrand(t) || EXTRA_COMPETITOR_BRANDS.test(t)) return "competitor_brand";
  if (CAFE_INTENT.test(t)) return "cafe_intent";
  if (NON_CAFE_FOOD.test(t)) return "non_cafe_food";
  if (DESSERT_BAKERY.test(t)) return "dessert_bakery";
  return "other";
}

export function shouldAutoExclude(intent: TermIntent): boolean {
  return (
    intent === "own_brand" ||
    intent === "non_cafe_food" ||
    intent === "competitor_brand" ||
    intent === "dessert_bakery"
  );
}

// ── Broad negative-theme ROOTS (2026-07-21) ─────────────────────────────────
// Google negative keyword themes are FUZZY: one root phrase blocks all its
// variants ("zus" catches "zus near me" + "zus coffee"; "coffee bean" catches
// "coffee bean and tea leaf near me" + "coffee bean shah alam"). Excluding the
// ROOT instead of each literal term is far more slot-efficient (Smart
// campaigns cap negatives) AND pre-blocks future variants that haven't been
// searched yet. Roots are chosen to never overlap café intent — e.g.
// "coffee bean" (a brand) is safe, bare "coffee" would NOT be and is absent.
// Ordered longest/most-specific first so "coffee bean" wins over a bare token.
const COMPETITOR_ROOTS = [
  "coffee bean", "oriental kopi", "kopi saigon", "kopi satu",
  "gigi coffee", "bask bear", "secret recipe", "hock kee", "hainan kopitiam", "temu coffee",
  "vinyl cafe", "zus", "kenangan", "luckin", "tealive", "cbtl", "starbucks", "nasken",
  "mykori", "richiamo", "kopihut", "cotti", "qbistro", "iffat", "chef kecik",
];
const FOOD_ROOTS = [
  "kedai makan", "food court", "restaurant", "restoran", "makanan", "makan", "warung",
  "gerai", "nasi", "ayam", "mamak", "burger", "pizza", "steak", "seafood", "sushi",
  "ramen", "noodle", "laksa", "satay", "tomyam", "catering", "buffet", "kebab", "biryani",
  "美食", "food",
];
const DESSERT_ROOTS = [
  "ice cream", "bakery", "pastry", "dessert", "waffle", "donut", "doughnut", "gelato",
  "bingsu", "pudding", "brownie", "cake", "kek", "tart",
];

/**
 * Pure: the broad negative-theme root that should be excluded for a junk term,
 * or null to keep the literal term (own brand, or an unrecognised shape). The
 * root is what actually gets written to Google Ads.
 */
export function negativeThemeRoot(term: string, intent: TermIntent): string | null {
  const t = term.toLowerCase();
  const roots =
    intent === "competitor_brand" ? COMPETITOR_ROOTS
    : intent === "non_cafe_food" ? FOOD_ROOTS
    : intent === "dessert_bakery" ? DESSERT_ROOTS
    : null;
  if (!roots) return null; // own_brand / other → not root-consolidated
  return roots.find((r) => t.includes(r)) ?? null;
}

/** The exclusion phrase to write for a junk term: its root if any, else the literal. */
export function exclusionPhrase(term: string, intent: TermIntent): string {
  return negativeThemeRoot(term, intent) ?? term.toLowerCase();
}

// Don't bother Google (or the ledger) with terms whose spend is noise.
export const AUTO_EXCLUDE_MIN_COST_MYR = 2;
// Change-rate cap: at most this many new negatives per campaign per run, so a
// Smart campaign is never whiplashed and a bad rule can't mass-exclude.
export const AUTO_EXCLUDE_MAX_PER_RUN = 15;

export type TermSpend = { campaignId: string; searchTerm: string; costMyr: number };
export type ExclusionCandidate = TermSpend & { intent: TermIntent; seeded?: boolean };

/**
 * Pure: seed campaigns with junk terms PROVEN at sibling campaigns (owner
 * 2026-07-17: "shah alam, do junk-term as well"). Junk intent is not
 * outlet-specific — "restaurants near me" is waste at every outlet — but a
 * campaign with no search-term history yet (the sync only just started
 * covering it) has nothing measured to exclude. So terms that were actually
 * observed, classified auto-excludable, and excluded somewhere in the fleet
 * transfer to every other campaign as negatives. Seeded exclusions carry NO
 * measured cost (costMyr 0) — they improve spend quality immediately but
 * never size a waste-matched budget cut.
 */
export function selectSeedExclusions(
  campaignIds: string[],
  fleetJunkTerms: string[],
  alreadyDecided: Set<string>,
  maxPerCampaign = AUTO_EXCLUDE_MAX_PER_RUN,
): ExclusionCandidate[] {
  const picked: ExclusionCandidate[] = [];
  for (const campaignId of campaignIds) {
    let used = 0;
    const seen = new Set<string>();
    for (const term of fleetJunkTerms) {
      if (used >= maxPerCampaign) break;
      const intent = classifyTermIntent(term);
      if (!shouldAutoExclude(intent)) continue;
      // Emit the broad root (slot-efficient, fuzzy) rather than the literal.
      const phrase = exclusionPhrase(term, intent);
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      if (alreadyDecided.has(`${campaignId} ${phrase}`)) continue;
      picked.push({ campaignId, searchTerm: phrase, costMyr: 0, intent, seeded: true });
      used++;
    }
  }
  return picked;
}

/**
 * Pure: pick this run's auto-exclusions. `alreadyDecided` holds
 * "<campaignId> <term>" keys for EVERY existing ledger row regardless of
 * status — an applied exclusion needs no repeat, and a human "rejected" is a
 * standing no the autopilot must respect.
 */
export function selectAutoExclusions(
  spend: TermSpend[],
  alreadyDecided: Set<string>,
  opts: { minCostMyr?: number; maxPerCampaign?: number } = {},
): ExclusionCandidate[] {
  const minCost = opts.minCostMyr ?? AUTO_EXCLUDE_MIN_COST_MYR;
  const maxPerCampaign = opts.maxPerCampaign ?? AUTO_EXCLUDE_MAX_PER_RUN;

  // Group qualifying junk by (campaign, ROOT): many literal terms collapse to
  // one broad negative theme, so one slot covers them all and their spend sums.
  type Agg = { campaignId: string; phrase: string; intent: TermIntent; costMyr: number };
  const byRoot = new Map<string, Agg>();
  for (const s of spend) {
    const term = s.searchTerm.toLowerCase();
    const intent = classifyTermIntent(term);
    if (!shouldAutoExclude(intent)) continue;
    const phrase = exclusionPhrase(term, intent);
    if (alreadyDecided.has(`${s.campaignId} ${phrase}`)) continue;
    const key = `${s.campaignId} ${phrase}`;
    const agg = byRoot.get(key) ?? { campaignId: s.campaignId, phrase, intent, costMyr: 0 };
    agg.costMyr += s.costMyr;
    byRoot.set(key, agg);
  }

  const picked: ExclusionCandidate[] = [];
  const perCampaign = new Map<string, number>();
  const sorted = [...byRoot.values()].sort((a, b) => b.costMyr - a.costMyr);
  for (const a of sorted) {
    if (a.costMyr < minCost) continue; // summed root spend below the noise floor
    const used = perCampaign.get(a.campaignId) ?? 0;
    if (used >= maxPerCampaign) continue;
    perCampaign.set(a.campaignId, used + 1);
    picked.push({ campaignId: a.campaignId, searchTerm: a.phrase, costMyr: a.costMyr, intent: a.intent });
  }
  return picked;
}
