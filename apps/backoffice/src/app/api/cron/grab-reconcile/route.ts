import { NextResponse } from "next/server";
import { reconcileGrabOrders } from "@/lib/grab-reconcile";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Safety net for dropped GrabFood orders: diff Grab's own order list against
// pos_orders and backfill anything missing (so a missed/empty/out-of-order
// webhook can't silently lose an order's docket AND its revenue). Runs frequently
// — see vercel.json. Idempotent: only inserts orders we don't already have.
async function runGrabReconcile() {
  const summary = await reconcileGrabOrders();
  return NextResponse.json({ ok: true, ...summary });
}

// Heartbeat tier: a silent no-run means dropped GrabFood webhooks lose orders
// (docket AND revenue) with nothing else to catch them.
export const GET = cronRoute("grab-reconcile", runGrabReconcile, {
  schedule: "*/15 * * * *",
  maxRuntime: 5, // maxDuration 120s + margin
});
