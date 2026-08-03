import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { reconcileGrabOrders } from "@/lib/grab-reconcile";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { reconcileGrabAvailability } from "@/lib/grab-availability";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Two GrabFood safety nets, both idempotent, both on this one cron entry
// (vercel.json is at the 38-entry ceiling — fold in, never append).
//
//   orders       — diff Grab's own order list against pos_orders and backfill
//                  anything missing, so a missed/empty/out-of-order webhook
//                  can't silently lose an order's docket AND its revenue.
//   availability — re-push any item whose 86 status Grab isn't known to have.
//                  Grab throttles menu-record updates (409 "too frequently"),
//                  and a throttled push at the till used to be lost forever:
//                  closed on the register, still selling on Grab.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const summary = await reconcileGrabOrders();

  // Never let an availability failure mask the order-reconcile result.
  let availability: Awaited<ReturnType<typeof reconcileGrabAvailability>> | { error: string };
  try {
    availability = await reconcileGrabAvailability(getSupabaseAdmin());
  } catch (e) {
    availability = { error: e instanceof Error ? e.message : String(e) };
    console.error("[cron/grab-reconcile] availability reconcile failed:", e);
  }

  return NextResponse.json({ ok: true, ...summary, availability });
}
