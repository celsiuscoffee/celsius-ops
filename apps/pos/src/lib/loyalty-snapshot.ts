import { createClient } from "@supabase/supabase-js";

/**
 * Customer-display loyalty snapshot.
 *
 * One round-trip that bundles everything the second-screen member page
 * needs to render: identity, points, tier (current + next + progress),
 * active vouchers, claimables (admin + mystery), and the points shop.
 *
 * Uses ANON key to match the rest of /api/loyalty/* routes. Writes that
 * mutate balances stay on those existing endpoints (they own the RPC
 * fallbacks); this one is read-only.
 */

const BRAND_ID = "brand-celsius";

// Service-role is required because most loyalty tables (members,
// member_brands, issued_rewards, mystery_drops, admin_claimables, …)
// have RLS enabled and the anon key returns empty rowsets.
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^0-9]/g, "");
  const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
  return Array.from(
    new Set(
      [raw.trim(), digits, `+${digits}`, local, `0${local}`, `60${local}`, `+60${local}`].filter(
        Boolean,
      ),
    ),
  );
}

export type TierInfo = {
  id: string;
  slug: string;
  name: string;
  color: string;
  multiplier: number;
  sortOrder: number;
  /** Flat % off applied at checkout (0-100). Drives the AUTO tier-perk
   *  discount line. Bronze=0, Silver=3, Gold=5, Platinum=10, Staff=30,
   *  Black Card=50 at time of writing. */
  discount_percent: number;
  /** Whether this tier's % stacks on top of voucher discounts.
   *  Stackable (Bronze/Silver/Gold/Platinum): tier % applies on the
   *  remainder AFTER vouchers, both lines show on the receipt.
   *  Non-stackable (Staff/Black Card): tier % applies on raw subtotal
   *  and the voucher is dropped entirely — invitation tiers trade
   *  voucher flexibility for a much higher flat discount. Mirrors the
   *  rule in apps/order/src/lib/loyalty/promotions.ts applyTierDiscount. */
  stackable: boolean;
  /** Display strings shown under the BeansHero card — e.g. "1.5× Beans on
   *  all drinks", "Free birthday drink". Backoffice stores these on
   *  `tiers.benefits` (JSONB array). Empty for the next-tier preview. */
  benefits: string[];
} | null;

export type VoucherCard = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  expires_at: string | null;
  discount_type: string | null;
  discount_value: number | null;
  min_order_value: number | null;
  free_product_name: string | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  // Source-driven eyebrow on the wallet card. Mirrors
  // apps/pickup-native voucherSourceLabel(): mystery → "Mystery Bag",
  // mission → "Challenge", points_redemption → "Bean Points", etc.
  source_type:
    | "mystery"
    | "mission"
    | "birthday"
    | "referral"
    | "manual"
    | "points_redemption"
    | null;
};

export type ClaimableCard = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source_type: "promo" | "mystery_pending";
  expires_at: string | null;
  cta_label: string;
};

export type ShopCard = {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  image_url: string | null;
  affordable: boolean;
  category: string | null;
  // Discount shape — used by the register to compute how much to take
  // off the cart when the customer taps "Spend Beans". Kept on the
  // shop card so we don't need a round-trip to the redeem endpoint at
  // tap-time (Beans only burn at checkout commit).
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  free_product_name: string | null;
  free_product_ids: string[] | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
};

/** Active weekly challenge for the member — mirrors the pickup-native
 *  /rewards "Challenges" section. Cashier doesn't tap these; they tick
 *  forward as the member places orders that match the goal. */
export type MissionCard = {
  id: string;                    // assignment_id
  title: string;
  description: string;
  icon: string | null;
  difficulty: "easy" | "medium" | "hard";
  progress_current: number;
  progress_target: number;
  /** "spend" challenges store progress in sen (10000 = RM 100). UI
   *  uses this to format as "RM 0 / RM 100" instead of "0 / 10000". */
  unit: "count" | "sen";
  reward_bonus_beans: number;
  status: "active" | "completed";
};

/** Live auto-promotion the cashier (and customer) should know about
 *  right now — drives the "Today's offers" section on the Visit
 *  Dashboard. Computed by filtering active promotions through their
 *  time/day windows and dropping any that don't actually save money
 *  on a typical cart. Pure AOV play: show what's claimable so the
 *  customer adds the matching item. */
export type ActivePromo = {
  id: string;
  name: string;
  description: string | null;
  /** Human-readable discount summary — "Save RM 2", "20% off",
   *  "Free item", etc. Pre-computed so the UI doesn't branch on type. */
  discount_label: string;
  /** Human-readable "live until 10am" / "Daily" / "Weekends" — quick
   *  glanceable window. */
  window_label: string;
  /** Source-type tag for theming: "time_window" (has time gates),
   *  "category" (applicable_categories set), "tag" (cohort),
   *  "always" (no gates). */
  flavour: "time_window" | "category" | "tag" | "always";
  /** True when the promo's day-of-week + time-window gate is
   *  currently satisfied (claimable on the active cart). When false,
   *  the customer is seeing the promo as a "come back at X for this"
   *  callout — still useful for AOV intent on the cart-side combo
   *  strip, but the empty-cart "Current promotions" grid filters to
   *  live=true so it doesn't show stale offers. */
  live: boolean;
};

/** Customer's most-ordered POS items, top N — drives the "Your usual"
 *  reorder strip. Includes the product id so the register can quick-add
 *  to cart in a future iteration. */
export type UsualItem = {
  id: string;                    // product_id
  name: string;
  price_sen: number;
  image_url: string | null;
  times_ordered: number;
};

/** Brand-wide popular bite items — drives the "Pair with a bite"
 *  fallback on the cart panel when the member's own usuals don't
 *  contain enough bite-category items (e.g. coffee-only regulars
 *  who'd benefit from a pastry suggestion). Pulled from the
 *  products table filtered to bite categories, ordered by recency
 *  as a proxy for popularity. */
export type BiteItem = {
  id: string;
  name: string;
  category: string;
  price_sen: number;
  image_url: string | null;
};

export type LoyaltySnapshot = {
  member: {
    id: string;
    name: string | null;
    phone: string;
    tags: string[];
    total_visits: number;
    total_spent: number;
  };
  balance: number;
  tier: {
    current: TierInfo;
    next: TierInfo;
    progress: { metric: "spend" | "visits"; current: number; target: number } | null;
  };
  vouchers: VoucherCard[];
  claimables: ClaimableCard[];
  missions: MissionCard[];
  usual: UsualItem[];
  popular_bites: BiteItem[];
  shop: ShopCard[];
  active_promos: ActivePromo[];
};

type Identifier = { kind: "phone"; value: string } | { kind: "memberId"; value: string };

/** Parse the source_type out of an issued_rewards.id prefix.
 *  issueVoucherFromTemplate mints ids like `ir-mystery-mpgx856l-vxtb0a`,
 *  `ir-mission-mpi9w9le-4lhvzm`, `ir-points_redemption-mpj9ivks-…`.
 *  When the dedicated source_type column is null (legacy rows), we
 *  recover the source from the prefix so the wallet card eyebrow
 *  still reads correctly. */
function sourceFromId(id: string): VoucherCard["source_type"] {
  if (!id?.startsWith("ir-")) return null;
  const rest = id.slice(3);
  const known = ["mystery", "mission", "birthday", "referral", "manual", "points_redemption"] as const;
  for (const s of known) {
    if (rest.startsWith(`${s}-`)) return s;
  }
  return null;
}

/**
 * Infer a usable discount shape for a Spend Beans reward. Some rewards
 * have all fields populated (`discount_type`, `discount_value`, etc.);
 * legacy ones rely on name parsing ("RM5" → fixed_amount 5, "Free
 * Drink" → free_item with applicable_categories). Mirrors the
 * buildDiscountInfo helper in /api/loyalty/redeem so the broadcasted
 * payload matches what the redeem endpoint would compute at commit.
 */
function inferShopDiscount(r: {
  name: string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  max_discount_value: number | string | null;
  free_product_name: string | null;
  free_product_ids: string[] | null;
}): {
  type: string | null;
  value: number | null;
  max_discount_value: number | null;
  free_product_name: string | null;
  free_product_ids: string[] | null;
} {
  // Structured reward — DB already has the shape.
  if (r.discount_type) {
    return {
      type: r.discount_type,
      value: r.discount_value !== null && r.discount_value !== undefined
        ? Number(r.discount_value)
        : null,
      max_discount_value: r.max_discount_value !== null && r.max_discount_value !== undefined
        ? Number(r.max_discount_value)
        : null,
      free_product_name: r.free_product_name ?? null,
      free_product_ids: r.free_product_ids ?? null,
    };
  }

  const name = (r.name ?? "").toLowerCase();

  // "RM5" / "RM 5" / "RM10" → fixed_amount
  const rmMatch = name.match(/rm\s?(\d+(?:\.\d+)?)/);
  if (rmMatch) {
    return {
      type: "fixed_amount",
      value: parseFloat(rmMatch[1]),
      max_discount_value: null,
      free_product_name: null,
      free_product_ids: null,
    };
  }

  // "Free X" → free_item. Cart-side handler will pick the cheapest
  // matching item (using applicable_categories / applicable_products
  // / free_product_ids in that priority order).
  if (name.includes("free")) {
    return {
      type: "free_item",
      value: 0,
      max_discount_value: null,
      free_product_name: r.free_product_name ?? r.name,
      free_product_ids: r.free_product_ids ?? null,
    };
  }

  // "X% off" → percentage
  const pctMatch = name.match(/(\d+)\s?%/);
  if (pctMatch) {
    return {
      type: "percentage",
      value: parseFloat(pctMatch[1]),
      max_discount_value: null,
      free_product_name: null,
      free_product_ids: null,
    };
  }

  // Unknown legacy reward — fall through with null type. UI can still
  // render the points cost; tap will no-op rather than misfire.
  return {
    type: null,
    value: null,
    max_discount_value: null,
    free_product_name: null,
    free_product_ids: null,
  };
}

/**
 * Resolve tier benefits to a flat string list for the BeansHero card.
 * Mirrors apps/pickup-native/app/tier-benefits.tsx: prefer the curated
 * `benefits` array (display copy), fall back to deriving labels from
 * `benefit_rules` (the structured perk definitions) when no curated
 * copy exists. This keeps tier configurations like Bronze — which
 * defines points_multiplier + birthday_reward as rules but has no
 * `benefits` array — visible on the customer-display.
 */
function resolveBenefitLabels(
  benefits: string[] | null,
  rules: Array<Record<string, unknown>> | null,
): string[] {
  const curated = Array.isArray(benefits)
    ? (benefits.filter((b) => typeof b === "string") as string[])
    : [];
  if (curated.length > 0) return curated;
  if (!Array.isArray(rules) || rules.length === 0) return [];
  return rules
    .map((r) => {
      const type = typeof r?.type === "string" ? r.type : "";
      const label = typeof r?.label === "string" ? r.label : null;
      switch (type) {
        case "points_multiplier": {
          const v = Number(r?.value ?? 1);
          if (v === 1) return null; // 1× isn't worth surfacing
          return `${v}× Beans on all orders`;
        }
        case "tier_discount": {
          const pct = Number(r?.percent ?? 0);
          return pct > 0 ? `${pct}% off every order` : null;
        }
        case "birthday_reward":
          return label ?? "Free birthday drink";
        case "early_access":
          return label ?? "Early access to new drinks";
        case "monthly_perk":
          return label ?? "Monthly member perk";
        case "exclusive_event":
          return label ?? "Exclusive event invites";
        default:
          return label;
      }
    })
    .filter((b): b is string => !!b);
}

export async function fetchLoyaltySnapshot(
  identifier: string | Identifier,
): Promise<LoyaltySnapshot | null> {
  const supabase = getClient();

  // Accept either a phone string (legacy) or a discriminated identifier.
  // Member-id lookups skip the phone-variants matching step entirely.
  const id: Identifier =
    typeof identifier === "string" ? { kind: "phone", value: identifier } : identifier;

  let member: { id: string; phone: string; name: string | null; tags: string[] | null } | null = null;
  if (id.kind === "memberId") {
    const { data } = await supabase
      .from("members")
      .select("id, phone, name, tags")
      .eq("id", id.value)
      .maybeSingle();
    member = data ?? null;
  } else {
    const variants = phoneVariants(id.value);
    const { data: members } = await supabase
      .from("members")
      .select("id, phone, name, tags")
      .in("phone", variants)
      .limit(1);
    member = members?.[0] ?? null;
  }
  if (!member) return null;

  const memberId = member.id;

  // Member's most-ordered items — unions POS register history
  // (pos_orders) with pickup-app history (orders). Mirrors the
  // pickup-native /api/loyalty/recent-items behavior so a regular
  // sees the same "your usual" whether they walk in or pickup.
  // Without the union, POS members saw their POS history but not
  // their pickup history (and vice versa) — confusing for anyone who
  // uses both channels.
  const usualPromise = (async (): Promise<UsualItem[]> => {
    if (!member!.phone) return [];
    const phoneSet = phoneVariants(member!.phone);

    // Parallel fetches: POS register orders + pickup app orders.
    // Each side caps at 50 recent so the aggregate stays bounded.
    const [posOrdersRes, pickupOrdersRes] = await Promise.all([
      supabase
        .from("pos_orders")
        .select("id")
        .in("loyalty_phone", phoneSet)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("orders")
        .select("id")
        .in("customer_phone", phoneSet)
        .in("status", ["paid", "preparing", "ready", "completed"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const posOrderIds = (posOrdersRes.data ?? []).map((o) => o.id as string);
    const pickupOrderIds = (pickupOrdersRes.data ?? []).map((o) => o.id as string);
    if (posOrderIds.length === 0 && pickupOrderIds.length === 0) return [];

    // Parallel line fetches from each item table. Different column
    // shapes between pos_order_items and order_items, so we read the
    // canonical fields per table and unify below.
    const [posItemsRes, pickupItemsRes] = await Promise.all([
      posOrderIds.length > 0
        ? supabase
            .from("pos_order_items")
            .select("product_id, product_name, quantity, unit_price")
            .in("order_id", posOrderIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      pickupOrderIds.length > 0
        ? supabase
            .from("order_items")
            .select("product_id, product_name, quantity, unit_price")
            .in("order_id", pickupOrderIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const counts = new Map<string, { name: string; n: number }>();
    const tally = (items: Array<Record<string, unknown>> | null | undefined) => {
      for (const it of items ?? []) {
        const pid = it.product_id as string;
        if (!pid) continue;
        const qty = (it.quantity as number) ?? 1;
        const row = counts.get(pid);
        if (row) row.n += qty;
        else counts.set(pid, { name: it.product_name as string, n: qty });
      }
    };
    tally(posItemsRes.data);
    tally(pickupItemsRes.data);

    const top = [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5);
    if (top.length === 0) return [];

    // Enrich with CURRENT price + image from products table — historical
    // unit_price could be stale if prices changed. Matches pickup-native
    // recent-items behavior (rejects unavailable products too).
    //
    // Important: products.price is stored as RM (numeric/string like
    // "8.9"), NOT sen. The customer-display UsualStrip displays
    // `price_sen / 100`, so without the * 100 conversion every tile
    // shows "RM 0.09" instead of "RM 8.90". See product-adapter.ts —
    // the rest of POS does the same RM → sen normalisation when
    // reading from this table.
    const ids = top.map(([id]) => id);
    const { data: prodRows } = await supabase
      .from("products")
      .select("id, image_url, price, is_available")
      .in("id", ids);
    const byId = new Map((prodRows ?? []).map((p) => [p.id as string, p]));
    return top
      .map(([id, v]): UsualItem | null => {
        const p = byId.get(id);
        if (!p || (p.is_available as boolean) === false) return null;
        return {
          id,
          name: v.name,
          price_sen: Math.round(Number(p.price ?? 0) * 100),
          image_url: (p.image_url as string) ?? null,
          times_ordered: v.n,
        };
      })
      .filter((x): x is UsualItem => x !== null);
  })();

  // Active weekly missions — same logic the pickup-native /rewards
  // screen uses. Joined with reward_missions to surface the title,
  // description, icon, reward, and goal.type (needed to format
  // progress correctly — spend missions store sen, count missions
  // store integer counts).
  const missionsPromise = (async (): Promise<MissionCard[]> => {
    const { data: assignments } = await supabase
      .from("mission_assignments")
      .select(
        "id, mission_id, progress_current, progress_target, status, reward_missions!inner(title, description, icon, difficulty, reward_bonus_beans, goal)",
      )
      .eq("member_id", memberId)
      .in("status", ["active", "completed"])
      .order("created_at", { ascending: false })
      .limit(5);
    if (!assignments) return [];
    return (assignments as any[]).map((a) => {
      // Spend-based goals (Big Bill, weekly spend, etc.) store
      // thresholds in sen on `reward_missions.goal.threshold` and
      // `mission_assignments.progress_*` is also in sen. Mark them
      // so the ChallengeRow component can format as RM.
      const goalType = a.reward_missions?.goal?.type as string | undefined;
      const isSpend = !!goalType && /spend|total|order_total|bill/.test(goalType);
      return {
        id:                  a.id as string,
        title:               a.reward_missions?.title ?? "Challenge",
        description:         a.reward_missions?.description ?? "",
        icon:                a.reward_missions?.icon ?? null,
        difficulty:          (a.reward_missions?.difficulty ?? "easy") as "easy" | "medium" | "hard",
        progress_current:    Number(a.progress_current ?? 0),
        progress_target:     Number(a.progress_target ?? 1),
        unit:                isSpend ? "sen" as const : "count" as const,
        reward_bonus_beans:  Number(a.reward_missions?.reward_bonus_beans ?? 0),
        status:              (a.status === "completed" ? "completed" : "active") as "active" | "completed",
      };
    });
  })();

  // Brand-wide popular bites — fallback for the "Pair with a bite"
  // suggestion strip on the cart panel. Bigger pool (24) so the
  // customer-display has room to sample across categories and
  // present a varied mix (cookie + croissant + cake + sandwich)
  // instead of three cakes in a row when recent items happen to
  // cluster on one category. The display owns the diversification
  // + shuffle logic; this just returns the pool.
  const popularBitesPromise = (async (): Promise<BiteItem[]> => {
    const BITE_CATEGORIES = [
      "croissant", "cookies", "cakes", "sandwiches",
      "roti-bakar", "nasi-lemak", "fries",
    ];
    const { data } = await supabase
      .from("products")
      .select("id, name, category, price, image_url, is_available")
      .in("category", BITE_CATEGORIES)
      .eq("is_available", true)
      .order("created_at", { ascending: false })
      .limit(24);
    if (!data) return [];
    return (data as Array<{ id: string; name: string; category: string; price: number | string; image_url: string | null }>)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price_sen: Math.round(Number(p.price ?? 0) * 100),
        image_url: p.image_url,
      }));
  })();

  // Active auto-promotions — pulled here so the dashboard's
  // "Today's offers" list and the engine evaluation stay aligned
  // (same `promotions` table, same filters). We compute the
  // current-time eligibility in JS rather than in Postgres so the
  // resulting list reflects the customer's local clock.
  const activePromosPromise = (async (): Promise<ActivePromo[]> => {
    const { data: rows } = await supabase
      .from("promotions")
      .select(
        "id, name, description, trigger_type, discount_type, discount_value, day_of_week, time_start, time_end, applicable_categories, applicable_tags, applicable_products, valid_from, valid_until, max_discount_value",
      )
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .in("trigger_type", ["auto"]); // first_order/tier_perk/code are noise here
    if (!rows || rows.length === 0) return [];

    const now = new Date();
    // Asia/Kuala_Lumpur — Celsius outlets are all UTC+8, and the
    // promo windows in the DB are stored as wall-clock times in MY
    // time. Convert "now" to that timezone for the day/time checks.
    const myNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    const dayIdx = myNow.getDay(); // 0=Sun..6=Sat
    const hh = myNow.getHours();
    const mm = myNow.getMinutes();
    const nowMinutes = hh * 60 + mm;

    // Eligibility split: anything outside valid_from/valid_until is
    // dropped (campaign is dead). Day-of-week + time-window
    // mismatches are KEPT but tagged live=false, so the cart-side
    // "Save with a combo" strip can still surface them as
    // "Available 8am-10am" intent for AOV. The empty-cart
    // "Current promotions" filters to live=true downstream.
    const eligible = rows.filter((r: any) => {
      if (r.valid_from && new Date(r.valid_from as string) > now) return false;
      if (r.valid_until && new Date(r.valid_until as string) < now) return false;
      return true;
    });

    return eligible.map((r: any) => {
      // Determine "live now" status: passes day-of-week + time-of-day
      // gates. False means "exists but not claimable on this cart" —
      // still shown as a forward-looking nudge.
      let live = true;
      if (Array.isArray(r.day_of_week) && r.day_of_week.length > 0) {
        if (!r.day_of_week.includes(dayIdx)) live = false;
      }
      if (live && r.time_start && r.time_end) {
        const [sh, sm] = (r.time_start as string).split(":").map(Number);
        const [eh, em] = (r.time_end as string).split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (nowMinutes < startMin || nowMinutes > endMin) live = false;
      }
      const dt = r.discount_type as string;
      const dv = Number(r.discount_value ?? 0);
      const discount_label =
        dt === "percentage_off"
          ? `${Math.round(dv)}% off`
          : dt === "fixed_amount_off"
            ? `Save RM ${dv.toFixed(0)}`
            : dt === "free_item"
              ? "Free item"
              : dt === "bogo"
                ? "Buy 1 Free 1"
                : "Discount";
      // Build a glanceable "live until X" / "Weekdays 8-10am" label.
      let window_label = "Daily";
      const days: number[] = Array.isArray(r.day_of_week) ? r.day_of_week : [];
      const hasTime = !!(r.time_start && r.time_end);
      if (days.length > 0 && days.length < 7) {
        const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const pretty = days.map((d: number) => labels[d] ?? "").filter(Boolean).join("/");
        window_label = pretty;
      }
      if (hasTime) {
        const fmt = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          const ampm = h >= 12 ? "pm" : "am";
          const hr = h % 12 || 12;
          return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
        };
        // If we're currently inside the window, say "until X" for
        // urgency. Otherwise show full range.
        const [eh, em] = (r.time_end as string).split(":").map(Number);
        const endMin = eh * 60 + em;
        const remainingMin = endMin - nowMinutes;
        if (remainingMin > 0 && remainingMin <= 60) {
          window_label = `Until ${fmt(r.time_end as string)} (${remainingMin}m left)`;
        } else {
          window_label =
            window_label === "Daily"
              ? `${fmt(r.time_start as string)}–${fmt(r.time_end as string)}`
              : `${window_label} · ${fmt(r.time_start as string)}–${fmt(r.time_end as string)}`;
        }
      }
      const flavour: ActivePromo["flavour"] = hasTime
        ? "time_window"
        : (r.applicable_categories?.length ?? 0) > 0
          ? "category"
          : (r.applicable_tags?.length ?? 0) > 0
            ? "tag"
            : "always";
      return {
        id: r.id as string,
        name: r.name as string,
        description: r.description as string | null,
        discount_label,
        window_label,
        flavour,
        live,
      };
    });
  })();

  const [mbRes, vouchersRes, dropsRes, pushedRes, shopRes, tiersRes] = await Promise.all([
    supabase
      .from("member_brands")
      .select("points_balance, total_visits, total_spent, current_tier_id")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .maybeSingle(),
    supabase
      .from("issued_rewards")
      .select(
        "id, title, description, icon, category, expires_at, discount_type, discount_value, min_order_value, free_product_name, applicable_categories, applicable_products, source_type",
      )
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .eq("status", "active")
      .order("issued_at", { ascending: false }),
    supabase
      .from("mystery_drops")
      .select("id, mystery_pool!inner(label, icon, reveal_emoji)")
      .eq("member_id", memberId)
      .is("revealed_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("admin_claimables")
      .select(
        "id, title, description, voucher_template_id, member_ids, ends_at, max_claims, total_claimed, voucher_templates!inner(icon, category)",
      )
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true),
    // Cleanup: the points shop reads the canonical voucher_templates
    // catalog (rows with points_cost set), not the legacy rewards table.
    // id:legacy_reward_id exposes the original 'reward-X' id so tapping a
    // tile still routes through /redeem (which keys on legacy_reward_id).
    // reward_type is dropped — it isn't on the template (all rows are
    // vouchers); the consumer below never reads it.
    supabase
      .from("voucher_templates")
      .select(
        "id:legacy_reward_id, name:title, description, points_required:points_cost, image_url, category, stock, is_active, discount_type, discount_value, max_discount_value, free_product_name, free_product_ids, applicable_categories, applicable_products",
      )
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .not("points_cost", "is", null)
      .order("points_cost", { ascending: true })
      .limit(20),
    // Fetch ALL active tiers (no sort_order filter). The previous
    // <= 50 cap hid admin tiers like Black Card (99) and Staff (90),
    // which silently dropped any member on those tiers back to Bronze
    // because the .find() below didn't match. We instead split them
    // at the "currentRow / nextRow" computation: ladder tiers (≤ 50)
    // drive the progress bar; admin tiers still resolve to the
    // member's actual tier name + color.
    supabase
      .from("tiers")
      .select("id, slug, name, color, multiplier, sort_order, min_spend, min_visits, qualification_metric, benefits, benefit_rules, discount_percent, stackable")
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const mb = mbRes.data ?? null;
  const balance = mb?.points_balance ?? 0;
  const totalSpent = parseFloat(String(mb?.total_spent ?? 0));
  const totalVisits = mb?.total_visits ?? 0;

  // ── Tier resolution ─────────────────────────────────────────
  const tiers = (tiersRes.data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    color: string;
    multiplier: string | number;
    sort_order: number;
    min_spend: string | number;
    min_visits: number;
    qualification_metric: "spend" | "visits";
    benefits: string[] | null;
    benefit_rules: Array<Record<string, unknown>> | null;
    discount_percent: number | string | null;
    stackable: boolean | null;
  }>;

  // Current tier — match by id from all tiers (admin or ladder), fall
  // back to first ladder tier (Bronze) when member hasn't been assigned.
  const ladderTiers = tiers.filter((t) => t.sort_order <= 50);
  const currentRow = tiers.find((t) => t.id === mb?.current_tier_id) ?? ladderTiers[0] ?? null;
  // Next tier shown for progress — only walk the public ladder, so a
  // Black Card / Staff member doesn't see "next: Staff" nonsense.
  const nextRow = currentRow && currentRow.sort_order <= 50
    ? ladderTiers.find((t) => t.sort_order > currentRow.sort_order) ?? null
    : null;

  const toInfo = (
    r: (typeof tiers)[number] | null,
  ): TierInfo =>
    r
      ? {
          id: r.id,
          slug: r.slug,
          name: r.name,
          color: r.color,
          multiplier: Number(r.multiplier),
          sortOrder: r.sort_order,
          discount_percent: Number(r.discount_percent ?? 0),
          stackable: r.stackable ?? true,
          // Display strings shown under BeansHero. Mirrors the pickup-
          // native fallback: prefer `tiers.benefits` (curated copy);
          // when empty, derive from `tiers.benefit_rules` so tiers
          // configured only with structured rules (e.g. Bronze) still
          // surface something. Without this fallback Bronze members
          // saw an empty hero card.
          benefits: resolveBenefitLabels(r.benefits, r.benefit_rules),
        }
      : null;

  const progress = nextRow
    ? nextRow.qualification_metric === "visits"
      ? { metric: "visits" as const, current: totalVisits, target: nextRow.min_visits }
      : { metric: "spend" as const, current: totalSpent, target: Number(nextRow.min_spend) }
    : null;

  // ── Vouchers — drop expired + bean-points redemptions ──────
  // Mirrors the native VoucherWallet filter: wallet surfaces only
  // passively-earned rewards (Mystery / Challenge / Birthday /
  // Referral / Promo). Bean-Points redemptions are catalog items the
  // customer JUST bought with beans — the points-shop flow already
  // stages them for the next order, so showing them in the wallet
  // duplicates the surface and inflates the rewards count.
  const now = Date.now();
  const vouchers: VoucherCard[] = (vouchersRes.data ?? [])
    .filter((v: any) => !v.expires_at || new Date(v.expires_at).getTime() > now)
    .filter((v: any) => {
      const src = v.source_type ?? sourceFromId(v.id as string);
      return src !== "points_redemption";
    })
    .map((v: any) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      icon: v.icon,
      category: v.category,
      expires_at: v.expires_at,
      discount_type: v.discount_type,
      discount_value: v.discount_value !== null ? Number(v.discount_value) : null,
      min_order_value: v.min_order_value !== null ? Number(v.min_order_value) : null,
      free_product_name: v.free_product_name,
      applicable_categories: v.applicable_categories,
      applicable_products: v.applicable_products,
      // Some legacy issued_rewards rows don't have source_type set on
      // the column, but the id was minted with the source baked into
      // the prefix (ir-{source}-{ts}-{rand}) by issueVoucherFromTemplate.
      // Recover the source from the id when the column is null so the
      // wallet card eyebrow still reads correctly.
      source_type: v.source_type ?? sourceFromId(v.id as string),
    }));

  // ── Claimables: mystery (always shown) + admin (filtered by audience + idempotency) ─
  const mysteryClaimables: ClaimableCard[] = ((dropsRes.data ?? []) as any[]).map((d) => ({
    id: d.id,
    title: d.mystery_pool?.label ?? "Mystery reward",
    description: "Tap to reveal your reward",
    icon: d.mystery_pool?.icon ?? "sparkle",
    source_type: "mystery_pending",
    expires_at: null,
    cta_label: "Reveal",
  }));

  const adminCandidates = ((pushedRes.data ?? []) as any[]).filter((c) => {
    if (c.ends_at && new Date(c.ends_at).getTime() < now) return false;
    if (c.max_claims !== null && (c.total_claimed ?? 0) >= c.max_claims) return false;
    const audience = (c.member_ids ?? []) as string[];
    if (audience.length && !audience.includes(memberId)) return false;
    return true;
  });

  let pushedClaimables: ClaimableCard[] = [];
  if (adminCandidates.length) {
    const ids = adminCandidates.map((c) => c.id);
    const { data: alreadyRows } = await supabase
      .from("admin_claimables_claimed")
      .select("claimable_id")
      .eq("member_id", memberId)
      .in("claimable_id", ids);
    const alreadyIds = new Set((alreadyRows ?? []).map((r: any) => r.claimable_id));

    pushedClaimables = adminCandidates
      .filter((c) => !alreadyIds.has(c.id))
      .map((c) => ({
        id: `admin:${c.id}`,
        title: c.title,
        description: c.description,
        icon: c.voucher_templates?.icon ?? "gift",
        source_type: "promo",
        expires_at: c.ends_at,
        cta_label: "Claim",
      }));
  }

  // ── Points shop ─────────────────────────────────────────────
  // Legacy rewards (Free Drink, RM5, RM10) have discount_type=null in
  // the DB — the type is implied by the name. Mirror the inference
  // /api/loyalty/redeem does (buildDiscountInfo) so the customer-
  // display can broadcast a usable discount shape AT TAP time without
  // a round-trip. Without this, tapping Free Drink sends type=null →
  // register's free_item branch never fires → cart total unchanged.
  const shop: ShopCard[] = ((shopRes.data ?? []) as any[])
    .filter((r) => r.stock === null || r.stock > 0)
    .map((r) => {
      const inferred = inferShopDiscount(r);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        points_required: r.points_required,
        image_url: r.image_url,
        affordable: r.points_required <= balance,
        category: r.category,
        discount_type: inferred.type,
        discount_value: inferred.value,
        max_discount_value: inferred.max_discount_value,
        free_product_name: inferred.free_product_name,
        free_product_ids: inferred.free_product_ids,
        applicable_categories: r.applicable_categories ?? null,
        applicable_products: r.applicable_products ?? null,
      };
    });

  const [missions, usual, active_promos, popular_bites] = await Promise.all([
    missionsPromise,
    usualPromise,
    activePromosPromise,
    popularBitesPromise,
  ]);

  return {
    member: {
      id: memberId,
      name: member.name,
      phone: member.phone,
      tags: member.tags ?? [],
      total_visits: totalVisits,
      total_spent: totalSpent,
    },
    balance,
    tier: {
      current: toInfo(currentRow),
      next: toInfo(nextRow),
      progress,
    },
    vouchers,
    claimables: [...mysteryClaimables, ...pushedClaimables],
    missions,
    usual,
    popular_bites,
    shop,
    active_promos,
  };
}
