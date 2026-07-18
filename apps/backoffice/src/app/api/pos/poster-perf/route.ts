import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * GET /api/pos/poster-perf?days=60 — the poster autopilot's report card.
 *
 * pos_poster_perf has logged daily per-round AOV tagged autopilot/control
 * since the switchback shipped, but nothing ever READ it — the A/B that
 * justifies the autopilot ("back off if it doesn't lift AOV", migration 035)
 * had no readout. This pools it: per round and overall, order-weighted AOV on
 * autopilot days vs control (popularity) days, with the day/order counts
 * behind each number so a thin sample reads as thin.
 *
 * Interpretation note: a switchback compares DAYS, so day-of-week mix and
 * promos are confounders until both modes have accrued a couple of weeks.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const days = Math.min(365, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 60));
    const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("pos_poster_perf")
      .select("perf_date, round, mode, aov_rm, orders")
      .gte("perf_date", sinceDate);
    if (error) throw new Error(error.message);

    type Row = { perf_date: string; round: string; mode: string; aov_rm: number | null; orders: number | null };
    type Acc = { days: number; orders: number; revenue: number };
    const blank = (): Acc => ({ days: 0, orders: 0, revenue: 0 });

    // Pool by (round, mode) with ORDER-weighted AOV — a 10-order Tuesday must
    // not count as much as a 200-order Saturday.
    const byRound = new Map<string, { autopilot: Acc; control: Acc }>();
    const totals = { autopilot: blank(), control: blank() };
    for (const r of (data ?? []) as Row[]) {
      if (r.mode !== "autopilot" && r.mode !== "control") continue;
      const orders = Number(r.orders ?? 0);
      const aov = Number(r.aov_rm ?? 0);
      if (!orders) continue;
      const e = byRound.get(r.round) ?? { autopilot: blank(), control: blank() };
      const acc = e[r.mode as "autopilot" | "control"];
      acc.days++; acc.orders += orders; acc.revenue += orders * aov;
      byRound.set(r.round, e);
      const t = totals[r.mode as "autopilot" | "control"];
      t.days++; t.orders += orders; t.revenue += orders * aov;
    }

    const fmt = (a: Acc) => ({
      days: a.days,
      orders: a.orders,
      aov_rm: a.orders ? +(a.revenue / a.orders).toFixed(2) : null,
    });
    const per_round = [...byRound.entries()]
      .map(([round, e]) => {
        const ap = fmt(e.autopilot), ct = fmt(e.control);
        return {
          round,
          autopilot: ap,
          control: ct,
          aov_delta_rm: ap.aov_rm != null && ct.aov_rm != null ? +(ap.aov_rm - ct.aov_rm).toFixed(2) : null,
        };
      })
      .sort((a, b) => (b.aov_delta_rm ?? -Infinity) - (a.aov_delta_rm ?? -Infinity));

    const ap = fmt(totals.autopilot), ct = fmt(totals.control);
    return NextResponse.json({
      since: sinceDate,
      totals: {
        autopilot: ap,
        control: ct,
        aov_delta_rm: ap.aov_rm != null && ct.aov_rm != null ? +(ap.aov_rm - ct.aov_rm).toFixed(2) : null,
      },
      per_round,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load poster perf";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
