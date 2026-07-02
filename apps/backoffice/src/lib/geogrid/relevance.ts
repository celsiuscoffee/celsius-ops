/**
 * Per-keyword relevance audit — the "act" side of the local-rank loop.
 *
 * Reviews (prominence) widen how far out you rank; whether you rank AT ALL for
 * a specific term is relevance, driven by the profile fields Google reads:
 * categories, services/products, description. This module diffs an outlet's
 * REAL Google Business Profile against its target keywords and says, per
 * keyword: covered where it counts, covered only weakly, or missing — plus the
 * concrete edit that closes the gap. Pure logic (profile + keywords in, report
 * out) so it's unit-testable; the API route supplies live GBP data.
 */
import type { GbpLocationProfile } from "@/lib/reviews/gbp";
import type { KeywordLever, TargetKeyword } from "@/lib/geogrid/target-keywords";

// Where a keyword must appear for Google to consider the profile relevant to
// it. Weight: categories > services > description (description is the weakest
// relevance signal of the three, but the only one that can carry geo terms).
export type Surface = "categories" | "services" | "description";

const PRIMARY_SURFACE: Record<KeywordLever, Surface> = {
  category: "categories",
  menu: "services",
  geo: "description",
};

// Category-lever terms are satisfied by holding the right CATEGORY, not by the
// literal word appearing somewhere. Maps core term → the GBP category to hold.
const CATEGORY_FOR_TERM: [RegExp, string][] = [
  [/\bcoffee shop\b/, "Coffee shop"],
  [/\bcafes?\b/, "Cafe"],
  [/\bcoffee\b/, "Coffee shop"],
  [/\bespresso\b/, "Espresso bar"],
  [/\bbreakfast\b/, "Breakfast restaurant"],
  [/\bbrunch\b/, "Brunch restaurant"],
  [/\bdessert\b/, "Dessert shop"],
  [/\bkopitiam\b/, "Kopitiam restaurant"],
  [/\brestaurants?\b/, "Restaurant"],
  [/\bfood\b/, "Restaurant"],
];

// Noise words that carry no relevance signal ("cafe NEAR ME", "BEST coffee").
const STOPWORDS = new Set(["near", "me", "best", "the", "a", "in", "at", "of", "and", "for", "my", "top"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** The keyword's signal-bearing core: stopwords stripped, order kept. */
export function coreTerms(keyword: string): string {
  return norm(keyword)
    .split(" ")
    .filter((w) => !STOPWORDS.has(w))
    .join(" ");
}

export function categoryForKeyword(keyword: string): string | null {
  const k = norm(keyword);
  for (const [re, cat] of CATEGORY_FOR_TERM) if (re.test(k)) return cat;
  return null;
}

// For keywords that arrive without a lever (e.g. GBP Performance API terms in
// GeoGridKeyword): category-mapped terms → category; drink/food items → menu;
// everything else (typically "<thing> <place>") → geo.
const MENU_WORDS = /\b(latte|matcha|mocha|americano|cappuccino|macchiato|croissant|cake|pastry|pastries|toast|sandwich|waffle|pancake|tea)\b/;

export function inferLever(keyword: string): KeywordLever {
  if (categoryForKeyword(keyword)) return "category";
  if (MENU_WORDS.test(norm(keyword))) return "menu";
  return "geo";
}

// Generic business words that a geo keyword shares with the category terms
// ("CAFE shah alam"). The categories carry those; the geo check only needs the
// PLACE part ("shah alam") to appear in the description.
const GENERIC_WORDS = new Set(["cafe", "cafes", "coffee", "shop", "kopitiam", "restaurant", "restaurants", "breakfast", "brunch", "dessert", "food"]);

/** The place part of a geo keyword: "cafe seksyen 13" → "seksyen 13". */
export function placeTerms(keyword: string): string {
  const place = coreTerms(keyword)
    .split(" ")
    .filter((w) => !GENERIC_WORDS.has(w))
    .join(" ");
  return place || coreTerms(keyword); // all-generic keyword: fall back to the core
}

export type KeywordCoverage = {
  keyword: string;
  clicks: number;
  lever: KeywordLever;
  /** Category-lever only: the GBP category that satisfies this term. */
  wantedCategory: string | null;
  foundIn: Surface[];
  /** strong = present on the surface that ranks it; weak = only elsewhere; missing = nowhere. */
  status: "strong" | "weak" | "missing";
  fix: string | null;
};

export type RelevanceReport = {
  profile: {
    title: string | null;
    primaryCategory: string | null;
    additionalCategories: string[];
    descriptionChars: number;
    servicesCount: number;
    hasWebsite: boolean;
    hasPhone: boolean;
    hasHours: boolean;
  };
  keywords: KeywordCoverage[];
  /** Deduped category adds implied by every missing category-lever term. */
  suggestedCategories: string[];
  summary: { strong: number; weak: number; missing: number };
};

function surfacesFor(profile: GbpLocationProfile): Record<Surface, string> {
  return {
    categories: norm([profile.primaryCategory ?? "", ...profile.additionalCategories].join(" · ")),
    services: norm(profile.services.join(" · ")),
    description: norm(profile.description ?? ""),
  };
}

function fixFor(kw: KeywordCoverage, core: string): string | null {
  if (kw.status === "strong") return null;
  switch (kw.lever) {
    case "category":
      return kw.wantedCategory
        ? `Add the "${kw.wantedCategory}" category (Edit profile → Business category).`
        : `Work "${core}" into the description and services.`;
    case "menu":
      return `Add "${core}" as a product/service with a short description (Edit profile → Services / Products).`;
    case "geo":
      return `Mention "${core}" in the business description (Edit profile → Description).`;
  }
}

/** Diff one outlet's live profile against its target keywords. */
export function auditRelevance(profile: GbpLocationProfile, targets: TargetKeyword[]): RelevanceReport {
  const surfaces = surfacesFor(profile);
  const heldCategories = new Set(
    [profile.primaryCategory ?? "", ...profile.additionalCategories].map(norm).filter(Boolean),
  );

  const keywords: KeywordCoverage[] = targets.map((t) => {
    // Geo keywords are matched by their place part only — the generic half
    // ("cafe …") is the categories' job, and searchers word it every way round.
    const core = t.lever === "geo" ? placeTerms(t.keyword) : coreTerms(t.keyword);
    const wantedCategory = t.lever === "category" ? categoryForKeyword(t.keyword) : null;

    const foundIn: Surface[] = [];
    // Category-lever: "found in categories" = we HOLD the right category.
    if (wantedCategory ? heldCategories.has(norm(wantedCategory)) : core && surfaces.categories.includes(core)) {
      foundIn.push("categories");
    }
    for (const s of ["services", "description"] as const) {
      if (core && surfaces[s].includes(core)) foundIn.push(s);
    }

    const status: KeywordCoverage["status"] =
      foundIn.length === 0 ? "missing" : foundIn.includes(PRIMARY_SURFACE[t.lever]) ? "strong" : "weak";

    const kw: KeywordCoverage = { keyword: t.keyword, clicks: t.clicks, lever: t.lever, wantedCategory, foundIn, status, fix: null };
    kw.fix = fixFor(kw, core);
    return kw;
  });

  const suggestedCategories = [
    ...new Set(
      keywords
        .filter((k) => k.status !== "strong" && k.wantedCategory && !heldCategories.has(norm(k.wantedCategory)))
        .map((k) => k.wantedCategory as string),
    ),
  ];

  return {
    profile: {
      title: profile.title,
      primaryCategory: profile.primaryCategory,
      additionalCategories: profile.additionalCategories,
      descriptionChars: (profile.description ?? "").length,
      servicesCount: profile.services.length,
      hasWebsite: !!profile.websiteUri,
      hasPhone: profile.hasPhone,
      hasHours: profile.hasHours,
    },
    keywords,
    suggestedCategories,
    summary: {
      strong: keywords.filter((k) => k.status === "strong").length,
      weak: keywords.filter((k) => k.status === "weak").length,
      missing: keywords.filter((k) => k.status === "missing").length,
    },
  };
}
