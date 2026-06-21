import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth, getUserFromHeaders } from "@/lib/auth";

const BRAND_ID = "brand-celsius";

// How far back a completed register order may be back-credited to a member who
// forgot to give their phone at the till. Deliberately short to limit abuse —
// the customer is expected to come back with their receipt soon after.
const MAX_AGE_DAYS = 3;

/**
 * Back-credit a PAST in-store order to a member who didn't give their phone
 * at the till.
 *
 * This is the "orders-only" alternative to the blanket points tools
 * (adjust-points / points-award, which let staff type any number): points here
 * are ALWAYS computed server-side from a real pos_orders row's spend — staff
 * can only attach a member to a specific completed order, never invent points.
 *
 * The earn math + idempotency mirror /api/pos/loyalty/complete (the live
 * in-store earn): Beans on the pre-tax net, tier-multiplied, one earn per order
 * (guarded on an existing 'earn' txn referencing the order). Points only — no
 * Mystery Bean drop for back-dated credits.
 *
 *   GET  ?order_number=CC-...   → preview the order + eligibility (no writes)
 *   POST { order_number, member_id, reason? } → attribute + award
 *
 * Backoffice access only (requireAuth). Every credit lands in point_transactions
 * with the acting staff + reason in the description, visible in Points Log.
 */

type PosOrderRow = {
  id: string;
  order_number: string | null;
  total: number | null;
  sst_amount: number | null;
  outlet_id: string | null;
  status: string | null;
  created_at: string | null;
  loyalty_phone: string | null;
  loyalty_points_earned: number | null;
};

async function getPointsPerRm(): Promise<number> {
  const { data: setting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "points_per_rm")
    .maybeSingle();
  return Number((setting?.value as { rate?: number } | null)?.rate ?? 1) || 1;
}

/** Base Beans for an order's spend BEFORE the member's tier multiplier.
 *  Mirrors /api/pos/loyalty/complete: earn on (total − SST), floored. */
function basePointsFor(order: PosOrderRow, pointsPerRm: number): number {
  const totalSen = Number(order.total ?? 0);
  const sstSen = Number(order.sst_amount ?? 0);
  const netSen = Math.max(0, totalSen - sstSen);
  return Math.floor((netSen / 100) * pointsPerRm);
}

/** Shared eligibility gate. Returns null when the order can be credited,
 *  otherwise the reason it can't. */
async function ineligibleReason(order: PosOrderRow): Promise<string | null> {
  if (order.status !== "completed") {
    return "Order is not completed.";
  }
  if (order.loyalty_phone) {
    return "Order is already attributed to a member.";
  }
  if (order.created_at) {
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    if (ageMs > MAX_AGE_DAYS * 86400000) {
      return `Order is older than ${MAX_AGE_DAYS} days — too old to credit.`;
    }
  }
  // Belt-and-braces: an earn txn already referencing the order means points
  // were credited (e.g. via a prior attribution). Never double-award.
  const { data: existingEarn } = await supabaseAdmin
    .from("point_transactions")
    .select("id")
    .eq("reference_id", order.id)
    .eq("type", "earn")
    .limit(1)
    .maybeSingle();
  if (existingEarn) {
    return "Points have already been awarded for this order.";
  }
  return null;
}

async function lookupOrder(orderNumber: string): Promise<PosOrderRow | null> {
  const { data } = await supabaseAdmin
    .from("pos_orders")
    .select("id, order_number, total, sst_amount, outlet_id, status, created_at, loyalty_phone, loyalty_points_earned")
    .eq("order_number", orderNumber)
    .maybeSingle();
  return (data as PosOrderRow | null) ?? null;
}

// ─── GET: preview ────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const orderNumber = request.nextUrl.searchParams.get("order_number")?.trim();
  if (!orderNumber) {
    return NextResponse.json({ error: "order_number is required" }, { status: 400 });
  }

  const order = await lookupOrder(orderNumber);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const pointsPerRm = await getPointsPerRm();
  const basePoints = basePointsFor(order, pointsPerRm);
  const reason = await ineligibleReason(order);

  return NextResponse.json({
    order: {
      id: order.id,
      order_number: order.order_number,
      total_rm: Number(order.total ?? 0) / 100,
      sst_rm: Number(order.sst_amount ?? 0) / 100,
      outlet_id: order.outlet_id,
      status: order.status,
      created_at: order.created_at,
    },
    // Beans before the member's tier multiplier — the final award applies the
    // selected member's multiplier on top (shown on confirm).
    base_points: basePoints,
    eligible: reason === null,
    reason,
  });
}

// ─── POST: attribute + award ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const caller = await getUserFromHeaders(request.headers);
  const callerLabel = caller?.name ?? caller?.id ?? "admin";

  const body = (await request.json()) as {
    order_number?: string;
    member_id?: string;
    reason?: string;
  };
  const orderNumber = body.order_number?.trim();
  const memberId = body.member_id?.trim();
  const note = (body.reason ?? "").trim();

  if (!orderNumber || !memberId) {
    return NextResponse.json(
      { error: "order_number and member_id are required" },
      { status: 400 },
    );
  }

  const order = await lookupOrder(orderNumber);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Re-check eligibility at commit time (the preview is advisory; state could
  // have changed). 409 = caller should refresh.
  const reason = await ineligibleReason(order);
  if (reason) {
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  // Resolve the member + their tier multiplier (same source as the live earn).
  const [{ data: memberRow }, { data: mb }] = await Promise.all([
    supabaseAdmin.from("members").select("id, phone, name").eq("id", memberId).maybeSingle(),
    supabaseAdmin
      .from("member_brands")
      .select("tiers(multiplier)")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .maybeSingle(),
  ]);
  if (!memberRow) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const member = memberRow as { id: string; phone: string | null; name: string | null };
  const tierMul =
    Number((mb as { tiers?: { multiplier?: number | null } | null } | null)?.tiers?.multiplier ?? 1) || 1;

  const pointsPerRm = await getPointsPerRm();
  const basePoints = basePointsFor(order, pointsPerRm);
  const points = Math.round(basePoints * tierMul);
  if (points <= 0) {
    return NextResponse.json({ error: "Order earns no points." }, { status: 400 });
  }

  // Award first (idempotent on order via the earn-txn guard above), then
  // attribute the order. If attribution write fails after the award lands, the
  // points are already credited and referenced to the order — no double-award
  // is possible because the earn-txn guard will block any retry.
  const { error: rpcErr } = await supabaseAdmin.rpc("add_loyalty_points", {
    p_member_id: memberId,
    p_brand_id: BRAND_ID,
    p_points: points,
    p_outlet_id: order.outlet_id ?? "",
    p_order_id: order.id,
    p_multiplier: tierMul,
    p_description: `Back-credit for order ${order.order_number} by ${callerLabel}${note ? `: ${note}` : ""}`,
  });
  if (rpcErr) {
    console.error("[credit-order] add_loyalty_points failed:", rpcErr.message);
    return NextResponse.json({ error: "Failed to award points." }, { status: 500 });
  }

  // Attribute the order to the member (for reporting + so the reconcile cron
  // never re-processes it) and stamp the earned points.
  await supabaseAdmin
    .from("pos_orders")
    .update({
      loyalty_phone: member.phone,
      loyalty_id: member.id,
      loyalty_points_earned: points,
    })
    .eq("id", order.id);

  // Tier re-eval so a member who just crossed a threshold bumps immediately.
  await supabaseAdmin
    .rpc("evaluate_member_tier", { p_member_id: memberId, p_brand_id: BRAND_ID })
    .then(() => {}, () => {});

  // New balance for the response (best-effort).
  const { data: after } = await supabaseAdmin
    .from("member_brands")
    .select("points_balance")
    .eq("member_id", memberId)
    .eq("brand_id", BRAND_ID)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    points_awarded: points,
    multiplier: tierMul,
    new_balance: (after as { points_balance?: number } | null)?.points_balance ?? null,
    order_number: order.order_number,
    member: { id: member.id, name: member.name, phone: member.phone },
  });
}
