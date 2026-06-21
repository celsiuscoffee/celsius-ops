import { getSupabaseAdmin } from "@/lib/supabase/server";
import { CATEGORY_GROUPS } from "./v2";

export type CartLine = { product_id: string; quantity: number; total_sen: number };

export type CartChallenge = {
  title: string;       // mission title (internal-ish, e.g. "Make it a Meal")
  reward: string;      // reward voucher title, e.g. "Free Coffee"
  message: string;     // "Spend RM12 more to unlock Free Coffee"
  met: boolean;        // the current cart already qualifies
  progressPct: number; // 0..1
};

// Friendly nouns for the "add ___" nudge.
const GROUP_ADD: Record<string, string> = { drinks: "a drink", food: "a bite", pastry: "a pastry" };
const GROUP_NOUN: Record<string, string> = { drinks: "drink", food: "food item", pastry: "pastry" };

// Only SINGLE-ORDER goals can be completed by THIS basket → nudgeable at the cart.
const SINGLE_ORDER_TYPES = new Set([
  "single_order_total_at_least", "single_order_item_count",
  "single_order_group_count", "single_order_has_groups",
]);

// Don't nudge a mission the basket is less than this fraction toward (avoids
// "Spend RM80 more" on a tiny cart). We show the CLOSEST qualifying one.
const FLOOR = 0.3;

type Goal = { type: string; threshold?: number; group?: string; groups?: string[] };

/**
 * The single best AOV challenge to nudge at the cart for this member + basket:
 * among their ACTIVE single-order missions, the closest-to-complete one, with
 * a "spend RMx more / add N more → reward" message. Reuses the engine's
 * CATEGORY_GROUPS so the nudge matches what actually completes the mission.
 */
export async function bestCartChallenge(memberId: string | null, lines: CartLine[]): Promise<CartChallenge | null> {
  if (!memberId || !lines.length) return null;
  try {
    const supabase = getSupabaseAdmin();

    const { data: assigns } = await supabase
      .from("mission_assignments")
      .select("mission_id")
      .eq("member_id", memberId)
      .eq("status", "active");
    const missionIds = [...new Set((assigns ?? []).map((a) => (a as { mission_id: string }).mission_id))];
    if (!missionIds.length) return null;

    const { data: missionRows } = await supabase
      .from("reward_missions")
      .select("id, title, goal, reward_voucher_template_ids")
      .in("id", missionIds)
      .eq("is_active", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row
    const missions = ((missionRows ?? []) as any[]).filter((m) => SINGLE_ORDER_TYPES.has((m.goal as Goal)?.type));
    if (!missions.length) return null;

    const pids = [...new Set(lines.map((l) => l.product_id))];
    const tplIds = [...new Set(missions.flatMap((m) => (m.reward_voucher_template_ids ?? []) as string[]))];
    const [prodRes, tplRes] = await Promise.all([
      supabase.from("products").select("id, category").in("id", pids),
      tplIds.length
        ? supabase.from("voucher_templates").select("id, title").in("id", tplIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ]);
    const catOf = new Map(((prodRes.data ?? []) as { id: string; category: string | null }[]).map((p) => [p.id, p.category]));
    const tplTitle = new Map(((tplRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));

    // Cart aggregates.
    const subtotalSen = lines.reduce((s, l) => s + (l.total_sen || 0), 0);
    const itemCount = lines.reduce((s, l) => s + (l.quantity || 0), 0);
    const groupQty = new Map<string, number>();
    for (const l of lines) {
      const cat = catOf.get(l.product_id);
      if (!cat) continue;
      for (const [g, list] of Object.entries(CATEGORY_GROUPS)) {
        if (list.includes(cat)) groupQty.set(g, (groupQty.get(g) ?? 0) + (l.quantity || 0));
      }
    }

    const out: CartChallenge[] = [];
    for (const m of missions) {
      const goal = m.goal as Goal;
      const reward = (m.reward_voucher_template_ids?.[0] && tplTitle.get(m.reward_voucher_template_ids[0])) || "a reward";
      const title = (m.title as string) ?? "Challenge";
      let met = false;
      let pct = 0;
      let message = "";

      if (goal.type === "single_order_total_at_least") {
        const thr = goal.threshold ?? 0;
        pct = thr ? Math.min(1, subtotalSen / thr) : 0;
        met = subtotalSen >= thr;
        const gapRm = Math.max(0, Math.ceil((thr - subtotalSen) / 100));
        message = met ? `This order unlocks ${reward}` : `Spend RM${gapRm} more to unlock ${reward}`;
      } else if (goal.type === "single_order_item_count") {
        const thr = goal.threshold ?? 0;
        pct = thr ? Math.min(1, itemCount / thr) : 0;
        met = itemCount >= thr;
        const gap = Math.max(0, thr - itemCount);
        message = met ? `This order unlocks ${reward}` : `Add ${gap} more item${gap === 1 ? "" : "s"} to unlock ${reward}`;
      } else if (goal.type === "single_order_group_count") {
        const g = goal.group ?? "";
        const thr = goal.threshold ?? 0;
        const have = groupQty.get(g) ?? 0;
        pct = thr ? Math.min(1, have / thr) : 0;
        met = have >= thr;
        const gap = Math.max(0, thr - have);
        const noun = GROUP_NOUN[g] ?? g;
        message = met ? `This order unlocks ${reward}` : `Add ${gap} more ${noun}${gap === 1 ? "" : "s"} to unlock ${reward}`;
      } else if (goal.type === "single_order_has_groups") {
        const groups = goal.groups ?? [];
        if (!groups.length) continue;
        const missing = groups.filter((g) => (groupQty.get(g) ?? 0) === 0);
        pct = (groups.length - missing.length) / groups.length;
        met = missing.length === 0;
        message = met
          ? `This order unlocks ${reward}`
          : `Add ${missing.map((g) => GROUP_ADD[g] ?? `a ${g}`).join(" + ")} to unlock ${reward}`;
      } else {
        continue;
      }
      out.push({ title, reward, message, met, progressPct: pct });
    }

    const unmet = out.filter((c) => !c.met && c.progressPct >= FLOOR).sort((a, b) => b.progressPct - a.progressPct);
    if (unmet.length) return unmet[0];
    const metOnes = out.filter((c) => c.met).sort((a, b) => b.progressPct - a.progressPct);
    return metOnes[0] ?? null;
  } catch (e) {
    console.error("[cart-challenge] error:", e);
    return null;
  }
}
