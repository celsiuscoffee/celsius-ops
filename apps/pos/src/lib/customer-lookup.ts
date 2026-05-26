import { createClient } from "./supabase-browser";

export type MemberTier = {
  id: string;
  slug: string;
  name: string;
  color: string;
  multiplier: number;
  /** Flat % off applied at checkout (0-100). Drives the AUTO tier-perk
   *  discount + the non-stackable rule below. */
  discount_percent: number;
  /** Stackable tiers (Bronze/Silver/Gold/Platinum): tier % applies on
   *  remainder after voucher. Non-stackable (Staff/Black Card): voucher
   *  is dropped, tier % applies on raw subtotal. */
  stackable: boolean;
};

export type LoyaltyMember = {
  id: string;
  phone: string;
  name: string | null;
  tags: string[];
  points_balance: number;
  total_spent: number;
  total_visits: number;
  last_visit_at: string | null;
  tier?: MemberTier | null;
};

/**
 * Look up a loyalty member by phone number.
 * Searches the existing `members` + `member_brands` tables from the Loyalty app.
 * Returns member info with tags, points, and spend history.
 */
export async function lookupMemberByPhone(phone: string): Promise<LoyaltyMember | null> {
  // The `members` table has zero RLS policies → anon Supabase queries
  // hit "permission denied". Route via the service-role API endpoint
  // instead. /api/loyalty/lookup owns the phone-variant matching so
  // both this caller and any future callers stay consistent.
  try {
    const res = await fetch(`/api/loyalty/lookup?phone=${encodeURIComponent(phone)}`, {
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { member?: LoyaltyMember | null };
    return json.member ?? null;
  } catch (err) {
    console.error("[lookupMemberByPhone] failed:", err);
    return null;
  }
}

/**
 * Get all unique member tags in use (for promotion setup)
 */
export async function fetchAllMemberTags(): Promise<string[]> {
  const supabase = createClient();
  let data: string[] | null = null;
  try {
    const res = await supabase.rpc("get_distinct_member_tags");
    data = res.data as string[] | null;
  } catch { /* RPC doesn't exist, use fallback */ }

  // Fallback: query directly
  if (!data) {
    const { data: members } = await supabase
      .from("members")
      .select("tags")
      .not("tags", "eq", "{}");
    if (!members) return [];
    const allTags = new Set<string>();
    for (const m of members) {
      for (const tag of (m.tags ?? [])) {
        allTags.add(tag);
      }
    }
    return [...allTags].sort();
  }
  return (data as string[]).sort();
}

/**
 * Check if a member meets the eligibility criteria of a promotion.
 */
export function memberMeetsEligibility(
  member: LoyaltyMember | null,
  eligibility: string,
  eligibleTags: string[],
  eligibleTiers: string[],
): boolean {
  switch (eligibility) {
    case "everyone":
      return true;

    case "customer_tags":
      if (!member) return false;
      // Member must have at least one of the eligible tags
      return eligibleTags.some((tag) => member.tags.includes(tag));

    case "membership":
      if (!member) return false;
      // Member must have a tier tag matching one of the eligible tiers
      return eligibleTiers.some((tier) => member.tags.includes(tier));

    case "first_time":
      if (!member) return true; // No member record = first time
      return member.total_visits <= 1;

    case "min_spend":
      if (!member) return false;
      // Check if member has spent enough (for future use)
      return true;

    default:
      return true;
  }
}
