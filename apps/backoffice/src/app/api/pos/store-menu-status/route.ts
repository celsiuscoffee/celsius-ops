import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import {
  getMYTToday,
  getMYTDateStr,
  getMYTHourNow,
  addDays,
  dayOfWeek,
} from "../../sales/_lib/native-sales-helpers";

/**
 * GET /api/pos/store-menu-status
 *
 * Live operational board, benchmarked on Hubbo POS's "Store/Menu Status"
 * report. Two halves on our own data:
 *
 *   • Store status — per active outlet: open/paused (Outlet.isOpen +
 *     app_settings.outlet_open_override = a manual force-close), operating
 *     hours, today's POS order count vs the same-weekday average, and the last
 *     order time. The headline alarm mirrors Hubbo: an outlet that is OPEN but
 *     has taken zero orders today (the "open but nobody's serving" failure the
 *     order-alerts work targets), plus a softer "quiet" flag in the afternoon.
 *
 *   • Menu status — the "86" board. Snoozed = an outlet has an
 *     outlet_product_availability row with is_available=false for a product
 *     that is otherwise on the live menu (products.is_available=true). Normal =
 *     live menu minus snoozed. We also return the snoozed line items (outlet ·
 *     category · item · reason · since) — the current lost-sales list.
 *
 * Sources: Outlet (Prisma) + outlet_product_availability / products /
 * pos_orders / app_settings (Supabase). Read-only. MYT (UTC+8) calendar days.
 * Admins see every active outlet; everyone else is scoped to their own.
 */

export const dynamic = "force-dynamic";

// A sale that no longer counts — must drop out of "real orders today".
const DEAD = new Set(["cancelled", "failed", "refunded", "voided"]);

// How far back to look for the same-weekday baseline (9 weeks → up to 8 prior
// same-DOW days), and how many of those we average.
const LOOKBACK_DAYS = 63;

type StoreCard = {
  outletId: string;
  name: string;
  storeId: string | null;
  loyaltyId: string | null;
  isOpen: boolean;
  manualPause: boolean;
  openTime: string | null;
  closeTime: string | null;
  daysOpen: number[];
  openToday: boolean;
  todayOrders: number;
  avgWeekday: number;
  lastOrderAt: string | null;
  snoozed: number;
  menuTotal: number;
  alert: "open-no-orders" | "quiet" | "manual-pause" | "none";
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user;

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      isOpen: true,
      openTime: true,
      closeTime: true,
      daysOpen: true,
      loyaltyOutletId: true,
      pickupStoreId: true,
    },
    orderBy: { name: "asc" },
  });
  const scoped = isAdmin ? outlets : outlets.filter((o) => o.id === user.outletId);
  if (scoped.length === 0) {
    return NextResponse.json({ error: "No outlet" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const today = getMYTToday();
  const todayDow = dayOfWeek(today);
  const hourNow = getMYTHourNow();

  // ── Manual-pause overrides (store slug → pinned-closed) ──────────────────
  const { data: ovRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "outlet_open_override")
    .maybeSingle();
  const rawOv = (ovRow as { value?: unknown } | null)?.value;
  const override: Record<string, boolean> =
    rawOv && typeof rawOv === "object" && !Array.isArray(rawOv)
      ? (rawOv as Record<string, boolean>)
      : {};

  // ── Orders: today + same-weekday baseline, per outlet (by loyalty id) ────
  const sinceIso = new Date(`${addDays(today, -LOOKBACK_DAYS)}T00:00:00+08:00`).toISOString();
  const { data: orderRows } = await supabase
    .from("pos_orders")
    .select("outlet_id, created_at, status, refund_of_order_id")
    .gte("created_at", sinceIso);

  // outletId → dateStr → count, and outletId → latest created_at
  const byDate = new Map<string, Map<string, number>>();
  const lastAt = new Map<string, string>();
  for (const r of (orderRows ?? []) as {
    outlet_id: string | null;
    created_at: string;
    status: string | null;
    refund_of_order_id: string | null;
  }[]) {
    if (!r.outlet_id) continue;
    if (r.refund_of_order_id) continue;
    if (r.status && DEAD.has(r.status)) continue;
    const d = getMYTDateStr(r.created_at);
    let m = byDate.get(r.outlet_id);
    if (!m) byDate.set(r.outlet_id, (m = new Map()));
    m.set(d, (m.get(d) ?? 0) + 1);
    const prev = lastAt.get(r.outlet_id);
    if (!prev || r.created_at > prev) lastAt.set(r.outlet_id, r.created_at);
  }

  // Average over the last 8 same-weekday dates the outlet ACTUALLY traded
  // (a date present in the map = it took ≥1 order). Skipping absent dates keeps
  // pre-cutover / pre-launch zeros from diluting the baseline — a freshly
  // migrated outlet shows "—" (no baseline) rather than a misleadingly low avg.
  const sameWeekdayAvg = (loyaltyId: string): number => {
    const m = byDate.get(loyaltyId);
    if (!m) return 0;
    const counts: number[] = [];
    for (let w = 1; w <= 8; w++) {
      const c = m.get(addDays(today, -7 * w));
      if (c !== undefined) counts.push(c);
    }
    if (counts.length === 0) return 0;
    const sum = counts.reduce((a, b) => a + b, 0);
    return Math.round((sum / counts.length) * 10) / 10;
  };

  // ── Menu / availability ("86") ───────────────────────────────────────────
  const { data: prodRows } = await supabase
    .from("products")
    .select("id, name, category, is_available");
  const prodMap = new Map<string, { name: string; category: string | null; live: boolean }>();
  let menuTotal = 0;
  for (const p of (prodRows ?? []) as {
    id: string;
    name: string | null;
    category: string | null;
    is_available: boolean | null;
  }[]) {
    const live = p.is_available !== false;
    if (live) menuTotal++;
    prodMap.set(p.id, { name: p.name ?? p.id, category: p.category, live });
  }

  const { data: availRows } = await supabase
    .from("outlet_product_availability")
    .select("outlet_id, product_id, reason, updated_at")
    .eq("is_available", false);

  const slugToName = new Map<string, string>();
  for (const o of scoped) if (o.pickupStoreId) slugToName.set(o.pickupStoreId, o.name);
  const allowedSlugs = new Set(scoped.map((o) => o.pickupStoreId).filter(Boolean) as string[]);

  const snoozedByStore = new Map<string, number>();
  const snoozedItems: {
    storeId: string;
    outletName: string;
    category: string;
    item: string;
    reason: string | null;
    since: string;
  }[] = [];
  for (const a of (availRows ?? []) as {
    outlet_id: string;
    product_id: string;
    reason: string | null;
    updated_at: string;
  }[]) {
    if (!allowedSlugs.has(a.outlet_id)) continue; // scope + only known outlets
    const prod = prodMap.get(a.product_id);
    if (!prod || !prod.live) continue; // ignore globally-disabled items
    snoozedByStore.set(a.outlet_id, (snoozedByStore.get(a.outlet_id) ?? 0) + 1);
    snoozedItems.push({
      storeId: a.outlet_id,
      outletName: slugToName.get(a.outlet_id) ?? a.outlet_id,
      category: prod.category ?? "Uncategorised",
      item: prod.name,
      reason: a.reason,
      since: a.updated_at,
    });
  }
  snoozedItems.sort((x, y) => x.outletName.localeCompare(y.outletName) || x.category.localeCompare(y.category));

  // ── Assemble store cards ─────────────────────────────────────────────────
  const stores: StoreCard[] = scoped.map((o) => {
    const loyaltyId = o.loyaltyOutletId;
    const isOpen = o.isOpen === true;
    const manualPause = o.pickupStoreId ? override[o.pickupStoreId] === true : false;
    const todayOrders = loyaltyId ? byDate.get(loyaltyId)?.get(today) ?? 0 : 0;
    const avgWeekday = loyaltyId ? sameWeekdayAvg(loyaltyId) : 0;
    const snoozed = o.pickupStoreId ? snoozedByStore.get(o.pickupStoreId) ?? 0 : 0;
    const openToday = (o.daysOpen ?? []).includes(todayDow === 0 ? 7 : todayDow);

    let alert: StoreCard["alert"] = "none";
    if (manualPause) alert = "manual-pause";
    else if (isOpen && todayOrders === 0) alert = "open-no-orders";
    else if (isOpen && avgWeekday >= 5 && hourNow >= 14 && todayOrders < 0.4 * avgWeekday)
      alert = "quiet";

    return {
      outletId: o.id,
      name: o.name,
      storeId: o.pickupStoreId,
      loyaltyId,
      isOpen,
      manualPause,
      openTime: o.openTime,
      closeTime: o.closeTime,
      daysOpen: o.daysOpen ?? [],
      openToday,
      todayOrders,
      avgWeekday,
      lastOrderAt: loyaltyId ? lastAt.get(loyaltyId) ?? null : null,
      snoozed,
      menuTotal,
      alert,
    };
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    mytToday: today,
    mytHour: hourNow,
    menuTotal,
    stores,
    snoozedItems,
  });
}
