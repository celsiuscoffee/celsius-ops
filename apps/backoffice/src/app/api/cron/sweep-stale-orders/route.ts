import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sweep-stale-orders  (Vercel Cron, hourly)
 *
 * Safety net for customer orders left in a non-terminal status because staff
 * forgot to advance them, or the order never surfaced on the right till. Without
 * this, a stuck order shows "preparing" on the customer app forever (see the
 * C-1337 incident).
 *
 * After STALE_HOURS of no activity (updated_at):
 *
 * `orders` (customer pickup/QR app):
 *   - paid / preparing / ready  -> "completed"  — a real, paid sale that just
 *     wasn't advanced; "completed" is the HONEST status, not a fake.
 *   - pending (never paid)      -> "failed"     — an abandoned checkout.
 * Both get auto_resolved=true so the owner can see how often this happens
 * (a coaching signal that staff aren't marking orders done).
 *
 * `pos_orders` (native till + delivery) — Grab/delivery rows ONLY:
 *   - open / sent_to_kitchen / ready -> "completed". Grab orders are PREPAID
 *     and confirmed on arrival, but their docket lifecycle is unreliable (the
 *     COLLECTED/DELIVERED webhook state often doesn't transition them), so
 *     stragglers sat in "open" forever — dropping off the till KDS' serving
 *     view never happened and they were excluded from finance's completed-only
 *     counts. This used to be skipped on the assumption "Grab's own lifecycle
 *     closes them"; production showed that assumption is false. Till rows
 *     (source='pos') are NOT swept — they're already 'completed' at ring-up.
 *
 * Idempotent: a row already terminal (completed/failed/cancelled) won't match
 * the filter, so re-runs are no-ops. The 3h window means an order placed minutes
 * before close is never prematurely killed.
 */
const STALE_HOURS = 3;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();
  const nowIso = new Date().toISOString();

  // Paid / in-fulfilment stragglers -> completed (real sales; staff just didn't advance).
  const { data: completed, error: e1 } = await supabase
    .from("orders")
    .update({ status: "completed", auto_resolved: true, updated_at: nowIso })
    .in("status", ["paid", "preparing", "ready"])
    .lt("updated_at", cutoff)
    .select("id, order_number");
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // Unpaid abandoned carts -> failed.
  const { data: failed, error: e2 } = await supabase
    .from("orders")
    .update({ status: "failed", auto_resolved: true, updated_at: nowIso })
    .eq("status", "pending")
    .lt("updated_at", cutoff)
    .select("id, order_number");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Grab/delivery pos_orders stuck non-terminal -> completed. Scoped to delivery
  // sources so a still-open till cart (should never persist, but be safe) is
  // never force-closed by this sweep — those are handled at the register.
  const { data: grabCompleted, error: e3 } = await supabase
    .from("pos_orders")
    .update({ status: "completed", updated_at: nowIso })
    .in("status", ["open", "sent_to_kitchen", "ready"])
    .in("source", ["grabfood", "foodpanda", "shopeefood"])
    .is("refund_of_order_id", null)
    .lt("updated_at", cutoff)
    .select("id, order_number");
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  const summary = {
    staleHours: STALE_HOURS,
    completed: completed?.length ?? 0,
    failed: failed?.length ?? 0,
    grabCompleted: grabCompleted?.length ?? 0,
  };
  if (summary.completed || summary.failed || summary.grabCompleted) {
    console.log("[cron/sweep-stale-orders]", JSON.stringify({
      ...summary,
      completedOrders: (completed ?? []).map((o) => o.order_number),
      failedOrders: (failed ?? []).map((o) => o.order_number),
      grabCompletedOrders: (grabCompleted ?? []).map((o) => o.order_number),
    }));
  }
  return NextResponse.json({ ok: true, ...summary });
}
