import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { planPosterRotation } from "@/lib/pos/poster-autopilot";

/**
 * GET /api/cron/pos-poster-autopilot  (daily ~07:00 MYT)
 *
 * Auto-rotates customer-display posters to push AOV: scores each round's
 * posters (margin + food-attach in drink-heavy rounds + price anchor) and
 * flips splash_posters.active/sort_order to the best K per round. Gated by
 * app_settings.pos_poster_autopilot_enabled.
 *
 * Switchback A/B: even MYT-day-of-year = "autopilot" (margin/attach), odd =
 * "control" (popularity). Each run also records YESTERDAY's realised per-round
 * AOV into pos_poster_perf tagged with yesterday's mode — the holdout that
 * proves whether the autopilot actually beats popularity (and whether posters
 * move AOV at all). If it doesn't, we'll see it and back off.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A Date whose UTC fields equal the MYT (UTC+8) wall clock — used only for
// calendar-date and day-parity math (never for storing timestamps).
function mytShift(ms: number): Date {
  return new Date(ms + 8 * 3600 * 1000);
}
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - start) / 86400000);
}
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const modeFor = (d: Date): "autopilot" | "control" => (dayOfYear(d) % 2 === 0 ? "autopilot" : "control");

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = getSupabaseAdmin();

  const { data: flagRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "pos_poster_autopilot_enabled")
    .maybeSingle();
  const enabled = (flagRow?.value as { enabled?: boolean } | null)?.enabled ?? false;
  if (!enabled) return NextResponse.json({ ok: true, skipped: "disabled" });

  const now = Date.now();
  const today = mytShift(now);
  const mode = modeFor(today);

  // 1. Plan + apply for POS + home. POS rotates on the switchback A/B (no
  //    per-poster conversion signal); home always runs autopilot and learns
  //    from deeplink-attributed AOV (poster_events). Splash deferred.
  const placements = [
    { placement: "pos-display" as const, mode },
    { placement: "home" as const, mode: "autopilot" as const },
  ];
  let applied = 0;
  const activeByPlacement: Record<string, string[]> = {};
  for (const cfg of placements) {
    const decisions = await planPosterRotation({ mode: cfg.mode, placement: cfg.placement });
    for (const d of decisions) {
      const { error } = await supabase
        .from("splash_posters")
        .update({ active: d.active, sort_order: d.sortOrder } as Record<string, unknown>)
        .eq("id", d.posterId);
      if (error) console.error("[cron/pos-poster-autopilot] update", d.posterId, error.message);
      else applied++;
      if (d.active) (activeByPlacement[cfg.placement] ??= []).push(d.title ?? d.posterId);
    }
  }

  // 2. Record yesterday's realised per-round AOV, tagged with yesterday's mode.
  const yest = mytShift(now - 24 * 3600 * 1000);
  const yStr = isoDate(yest);
  const yMode = modeFor(yest);
  let logged = 0;
  const { data: perf } = await supabase.rpc("pos_round_aov_for_date", { p_date: yStr });
  for (const row of (perf ?? []) as { round: string; orders: number; aov_rm: number }[]) {
    if (!row.round || row.round === "other") continue;
    const { error } = await supabase
      .from("pos_poster_perf")
      .upsert(
        { perf_date: yStr, round: row.round, mode: yMode, aov_rm: row.aov_rm, orders: row.orders } as Record<string, unknown>,
        { onConflict: "perf_date,round" },
      );
    if (!error) logged++;
  }

  console.warn(`[cron/pos-poster-autopilot] mode=${mode} applied=${applied} perf_logged=${logged}`);
  return NextResponse.json({ ok: true, mode, applied, perfLogged: logged, activeByPlacement });
}
