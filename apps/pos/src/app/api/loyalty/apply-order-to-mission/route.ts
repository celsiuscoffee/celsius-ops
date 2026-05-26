import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/loyalty/apply-order-to-mission
 *
 * Walks every active mission_assignment for the member and ticks
 * progress based on the just-committed order. Mirrors the
 * applyOrderToMission function in apps/order/src/lib/loyalty/v2.ts so
 * POS orders advance challenges the same way pickup orders do — without
 * this, the customer's RM50 Bill / Weekend Run / Make it a Meal stays
 * at 0/X forever when they pay in-store.
 *
 * Fire-and-forget from the register: handleCheckoutComplete commits
 * the POS order, then POSTs here with the order summary. Failures here
 * don't roll back the order — worst case the member's challenge sits
 * untouched and the next visit catches up.
 *
 * Body:
 *   {
 *     member_id: string,
 *     order: {
 *       id: string,
 *       outlet_id: string,
 *       items: [{ product_id, category, quantity }],
 *       item_count: number,
 *       total_sen: number,
 *       created_at: ISO string,
 *     }
 *   }
 */

const BRAND_ID = "brand-celsius";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Broad category buckets the mission goals key off. Mirrors the
// CATEGORY_GROUPS table in apps/order/src/lib/loyalty/v2.ts — keep
// these in sync so the same goal scores the same in either channel.
const CATEGORY_GROUPS: Record<string, ReadonlyArray<string>> = {
  drinks: [
    "classic", "flavoured", "mocha", "artisan-choc", "artisan-matcha",
    "fruit-tea", "gourmet-tea", "mocktails",
  ],
  food: [
    "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches", "fries",
  ],
  pastry: ["cakes", "cookies", "croissant"],
};

interface OrderItem {
  product_id: string;
  category: string | null;
  quantity: number;
}

interface OrderForMission {
  id: string;
  outlet_id: string;
  items: OrderItem[];
  item_count: number;
  total_sen: number;
  created_at: string;
}

interface Goal {
  type: string;
  threshold?: number;
  group?: string;
  groups?: string[];
  filter?: {
    order_hour_lt?: number;
    order_day_in?: number[];
  };
}

/**
 * Increment the mission's progress_current by N based on what this
 * single order qualifies for. Returns 0 when the order doesn't move
 * the goal (wrong day/hour, no qualifying items, etc.).
 *
 * Goals that need history (distinct_outlets, distinct_new_products,
 * referrals_count) are intentionally NOT handled here — they need
 * member-wide order history and aren't part of the launch mission set.
 * If they get re-enabled later, port evalDedupedGoal from the order
 * app and wire it through.
 */
function evalGoalOnOrder(goal: Goal, order: OrderForMission): number {
  const created = new Date(order.created_at);
  if (
    goal.filter?.order_hour_lt !== undefined &&
    created.getHours() >= goal.filter.order_hour_lt
  ) {
    return 0;
  }
  if (
    goal.filter?.order_day_in &&
    !goal.filter.order_day_in.includes(created.getDay())
  ) {
    return 0;
  }
  const threshold = goal.threshold ?? 1;
  switch (goal.type) {
    case "orders_count":
      return threshold > 0 ? 1 : 0;
    case "single_order_item_count":
      return order.item_count >= threshold ? threshold : 0;
    case "single_order_total_at_least":
      return order.total_sen >= threshold ? threshold : 0;
    case "single_order_has_groups": {
      const groups = goal.groups ?? [];
      if (groups.length === 0) return 0;
      const cats = new Set(
        order.items.map((i) => i.category).filter((c): c is string => !!c),
      );
      const hasAll = groups.every((g) => {
        const list = CATEGORY_GROUPS[g] ?? [];
        return list.some((c) => cats.has(c));
      });
      return hasAll ? threshold : 0;
    }
    case "single_order_group_count": {
      const group = goal.group;
      if (!group) return 0;
      const list = new Set(CATEGORY_GROUPS[group] ?? []);
      const count = order.items
        .filter((i) => i.category && list.has(i.category))
        .reduce((s, i) => s + (i.quantity ?? 1), 0);
      return count >= threshold ? threshold : 0;
    }
    case "spend_amount":
      return order.total_sen;
    default:
      return 0;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { member_id, order } = (await req.json()) as {
      member_id: string;
      order: OrderForMission;
    };
    if (!member_id || !order) {
      return NextResponse.json(
        { error: "member_id and order required" },
        { status: 400 },
      );
    }

    const supabase = getAdmin();

    // Enrich items with current category from products table (caller
    // sends product_id but might not know the category — pos_orders
    // doesn't denormalise it).
    const itemIds = order.items.map((i) => i.product_id).filter(Boolean);
    if (itemIds.length > 0 && order.items.some((i) => !i.category)) {
      const { data: products } = await supabase
        .from("products")
        .select("id, category")
        .in("id", itemIds);
      const byId = new Map<string, string>();
      for (const p of products ?? []) {
        if (p.id && p.category) {
          byId.set(p.id as string, p.category as string);
        }
      }
      order.items = order.items.map((i) => ({
        ...i,
        category: i.category ?? byId.get(i.product_id) ?? null,
      }));
    }

    // Pull active assignments for this member.
    const { data: assignments } = await supabase
      .from("mission_assignments")
      .select("id, mission_id, progress_current, progress_target")
      .eq("member_id", member_id)
      .eq("status", "active");

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ updated: [], completed: [] });
    }

    const updated: string[] = [];
    const completed: string[] = [];

    for (const a of assignments) {
      const { data: mission } = await supabase
        .from("reward_missions")
        .select("id, title, goal, reward_voucher_template_ids")
        .eq("id", a.mission_id)
        .single();
      if (!mission) continue;

      const inc = evalGoalOnOrder(mission.goal as Goal, order);
      if (inc === 0) continue;

      const newProgress = (a.progress_current as number) + inc;
      const isDone = newProgress >= (a.progress_target as number);

      const { error } = await supabase
        .from("mission_assignments")
        .update({
          progress_current: newProgress,
          status: isDone ? "completed" : "active",
          completed_at: isDone ? new Date().toISOString() : null,
        })
        .eq("id", a.id);

      if (!error) {
        updated.push(a.id as string);
        if (isDone) completed.push(a.mission_id as string);
      }
    }

    return NextResponse.json({ updated, completed });
  } catch (err) {
    console.error("[POS] apply-order-to-mission:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "mission tick failed" },
      { status: 500 },
    );
  }
}
