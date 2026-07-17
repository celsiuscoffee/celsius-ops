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
 *   competitor_brand -> KEEP (conquesting a rival coffee brand's searchers is
 *                       real coffee demand — cutting it is a strategy call,
 *                       never automatic)
 *   dessert_bakery   -> KEEP (ambiguous: cafes sell cake; owner can exclude
 *                       from the Paid x Organic panel case by case)
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
  /\b(zus|kenangan|luckin|tealive|cbtl|coffee bean|starbucks|oriental kopi|nasken|mykori|kopi saigon|kopi satu|gigi coffee|bask bear|richiamo|secret recipe|iffat|chef kecik)\b/;

const CAFE_INTENT =
  /\b(coffee|cafe|cafes|kafe|kopi|kopitiam|latte|matcha|espresso|americano|cappuccino|mocha|brew|breakfast|brunch|croissant|croffle|study|wifi)\b/;

const NON_CAFE_FOOD =
  /\b(restaurant|restaurants|kedai makan|food|foods|makan|makanan|lunch|dinner|nasi|ayam|mamak|burger|pizza|steak|seafood|sushi|ramen|noodle|noodles|mee|laksa|satay|tomyam|tom yam|catering|buffet|shawarma|kebab|briyani|biryani)\b/;

const DESSERT_BAKERY =
  /\b(cake|cakes|kek|dessert|desserts|waffle|waffles|donut|doughnut|bakery|pastry|pastries|ice cream|gelato|bingsu)\b/;

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
  return intent === "own_brand" || intent === "non_cafe_food";
}

// Don't bother Google (or the ledger) with terms whose spend is noise.
export const AUTO_EXCLUDE_MIN_COST_MYR = 2;
// Change-rate cap: at most this many new negatives per campaign per run, so a
// Smart campaign is never whiplashed and a bad rule can't mass-exclude.
export const AUTO_EXCLUDE_MAX_PER_RUN = 15;

export type TermSpend = { campaignId: string; searchTerm: string; costMyr: number };
export type ExclusionCandidate = TermSpend & { intent: TermIntent };

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

  const picked: ExclusionCandidate[] = [];
  const perCampaign = new Map<string, number>();
  const sorted = [...spend].sort((a, b) => b.costMyr - a.costMyr);
  for (const s of sorted) {
    if (s.costMyr < minCost) continue;
    const term = s.searchTerm.toLowerCase();
    if (alreadyDecided.has(`${s.campaignId} ${term}`)) continue;
    const intent = classifyTermIntent(term);
    if (!shouldAutoExclude(intent)) continue;
    const used = perCampaign.get(s.campaignId) ?? 0;
    if (used >= maxPerCampaign) continue;
    perCampaign.set(s.campaignId, used + 1);
    picked.push({ ...s, searchTerm: term, intent });
  }
  return picked;
}
