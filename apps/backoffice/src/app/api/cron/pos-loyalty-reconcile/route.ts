import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, createSupabaseAdmin } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safety net for in-store (register) loyalty.
 *
 * Every in-store member sale awards Beans + a Mystery drop via
 * /api/pos/loyalty/complete. For an OFFLINE sale that step is deferred to the
 * till's sync-on-reconnect and is best-effort — so a single transient failure
 * (common right as the network comes back) can silently lose the member's
 * points + mystery, with no client retry. This cron re-checks recent completed
 * register orders that carry a loyalty phone but have NO Beans yet and awards
 * them, idempotently (the reconcile_pos_loyalty DB function skips anything that
 * already earned, and never double-spawns a drop).
 *
 * GET /api/cron/pos-loyalty-reconcile   (Authorization: Bearer <CRON_SECRET>)
 *
 * Window is deliberately short (recent offline syncs land within hours) so the
 * cron only heals fresh misses; a wider sweep can be run manually by calling
 * the DB function with a larger p_since_hours.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.rpc("reconcile_pos_loyalty", { p_since_hours: 6 });
  if (error) {
    console.error("[cron/pos-loyalty-reconcile]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && (row.orders_fixed ?? 0) > 0) {
    console.warn(
      `[cron/pos-loyalty-reconcile] backfilled ${row.orders_fixed} order(s): ` +
      `${row.points_awarded} points, ${row.drops_created} drops`,
    );
  }
  return NextResponse.json({ ok: true, ...(row ?? { orders_fixed: 0, points_awarded: 0, drops_created: 0 }) });
}
