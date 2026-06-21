import { getSupabaseAdmin } from "@/lib/supabase/server";

// Food categories (mirror the autopilot engine + suggest-pairs). Everything
// else is treated as a drink for the carousel's food/drink balance.
const FOOD_CATEGORIES = new Set([
  "cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches",
]);

// Current MYT day-part round (mirrors the autopilot + readers). "" = late night
// (only always-on posters show).
function currentRound(): string {
  const h = (new Date().getUTCHours() + 8) % 24;
  if (h >= 8 && h < 10) return "breakfast";
  if (h >= 10 && h < 12) return "brunch";
  if (h >= 12 && h < 15) return "lunch";
  if (h >= 15 && h < 17) return "midday";
  if (h >= 17 && h < 19) return "evening";
  if (h >= 19 && h < 21) return "dinner";
  if (h >= 21 && h < 23) return "supper";
  return "";
}

export type HomePoster = {
  id: string;
  image_url: string;
  title: string | null;
  deeplink: string | null;
  duration_ms: number;
};

type Row = {
  id: string; image_url: string; title: string | null; deeplink: string | null;
  duration_ms: number | null; starts_at: string | null; ends_at: string | null;
  round: string | null; rounds: string[] | null; product_id: string | null;
};

/**
 * The single source of truth for "which home posters show right now". Used by
 * BOTH the web home (page.tsx) and the native app (/api/home-posters) so they
 * never drift.
 *
 * Targeted, not spray: returns a TIGHT set — up to `limit` posters for the
 * current day-part window, balanced to (limit-1) high-AOV food + 1 signature
 * drink. A passive carousel only gets 1-2 posters of real attention, so we
 * show few and sharp rather than the whole catalogue.
 */
export async function selectHomePosters(opts?: { limit?: number; memberId?: string | null }): Promise<HomePoster[]> {
  const limit = Math.max(1, opts?.limit ?? 3);
  const memberId = opts?.memberId ?? null;
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const round = currentRound();

    const { data, error } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, duration_ms, starts_at, ends_at, round, rounds, product_id")
      .eq("brand_id", "brand-celsius")
      .eq("active", true)
      .eq("placement", "home")
      // Autopilot AOV rank (lower sort_order = stronger). NULLs to the back.
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    const rows = data as Row[];

    // Day-part window: show when the current round is in `rounds`; empty falls
    // back to the legacy single `round` (null round = always-on). Plus the
    // operator schedule window (starts/ends).
    const eligible = rows.filter((p) => {
      const startOk = !p.starts_at || p.starts_at <= now;
      const endOk = !p.ends_at || p.ends_at >= now;
      if (!startOk || !endOk) return false;
      if (p.rounds && p.rounds.length) return round !== "" && p.rounds.includes(round);
      if (p.round) return p.round === round;
      return true;
    });
    if (eligible.length <= limit) return eligible.map(toPoster);

    // Classify food vs drink so the tight set keeps a signature drink.
    const pids = eligible.map((p) => p.product_id).filter((x): x is string => !!x);
    const catById = new Map<string, string | null>();
    if (pids.length) {
      const { data: prods } = await supabase.from("products").select("id, category").in("id", pids);
      for (const pr of (prods ?? []) as { id: string; category: string | null }[]) catById.set(pr.id, pr.category);
    }
    const isDrink = (p: Row) => {
      const c = p.product_id ? catById.get(p.product_id) : null;
      return c ? !FOOD_CATEGORIES.has(c) : false;
    };

    // Personalize: surface what the member HASN'T tried first (discovery →
    // trial → AOV) — a regular who always orders pasta gets shown the items
    // they haven't had, not their usual. Untried sort ahead of tried; AOV order
    // is preserved within each group (stable sort over the sort_order list).
    const tried = await triedProductIds(supabase, memberId);
    const untriedFirst = (a: Row, b: Row) => {
      const at = a.product_id && tried.has(a.product_id) ? 1 : 0;
      const bt = b.product_id && tried.has(b.product_id) ? 1 : 0;
      return at - bt;
    };

    // Tight pick: top (limit-1) foods + top 1 drink (untried-first, then AOV),
    // then fill any shortfall from the rest, capped at `limit`, in sort order.
    const foods = eligible.filter((p) => !isDrink(p)).sort(untriedFirst);
    const drinks = eligible.filter((p) => isDrink(p)).sort(untriedFirst);
    const keep = new Set<string>([
      ...foods.slice(0, Math.max(1, limit - 1)).map((p) => p.id),
      ...drinks.slice(0, 1).map((p) => p.id),
    ]);
    for (const p of eligible) {
      if (keep.size >= limit) break;
      keep.add(p.id);
    }
    return eligible.filter((p) => keep.has(p.id)).slice(0, limit).map(toPoster);
  } catch {
    return [];
  }
}

function toPoster(p: Row): HomePoster {
  return {
    id: p.id,
    image_url: p.image_url,
    title: p.title ?? null,
    deeplink: p.deeplink ?? null,
    duration_ms: (p.duration_ms as number | null) ?? 5000,
  };
}

// Distinct product_ids a member has ordered (last ~100 orders). Best-effort —
// any failure returns an empty set so the carousel falls back to the AOV order.
async function triedProductIds(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  memberId: string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!memberId) return out;
  try {
    const { data: orders } = await supabase
      .from("orders")
      .select("id")
      .eq("loyalty_id", memberId)
      .order("created_at", { ascending: false })
      .limit(100);
    const ids = (orders ?? []).map((o: { id: string }) => o.id);
    if (!ids.length) return out;
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id")
      .in("order_id", ids);
    for (const it of (items ?? []) as { product_id: string | null }[]) {
      if (it.product_id) out.add(it.product_id);
    }
  } catch {
    /* personalization is best-effort */
  }
  return out;
}
