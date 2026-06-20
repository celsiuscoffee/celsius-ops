import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { reconcileGrabOrders } from "@/lib/grab-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Safety net for dropped GrabFood orders: diff Grab's own order list against
// pos_orders and backfill anything missing (so a missed/empty/out-of-order
// webhook can't silently lose an order's docket AND its revenue). Runs frequently
// — see vercel.json. Idempotent: only inserts orders we don't already have.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const summary = await reconcileGrabOrders();
  return NextResponse.json({ ok: true, ...summary });
}
