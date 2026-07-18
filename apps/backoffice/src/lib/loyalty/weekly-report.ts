import { getEvaluation, getPausedLoops } from "@/lib/loyalty/loop-engine";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { sendMessage } from "@/lib/telegram";

// Monday-morning Telegram scorecard for the SMS loop program, tracked against
// the owner's standing target (app_settings.marketing_target, default
// RM10k/month incremental margin at >=4x blended ROI). Fired by the DAILY
// loops-trigger cron on Mondays (MYT) — deliberately NOT its own Vercel cron:
// the repo runs against a hard cron budget (vercel-crons.test.ts).
// Reports trailing-30d run-rate (measured rounds only — conservative), the
// week's activity, per-loop standings, and anything the kill rule retired.
// The 4x floor is a PORTFOLIO health line, not a per-loop kill bar — loops die
// only when they can't cover themselves (see autoPauseUnderperformers).
const DEFAULT_TARGET = { margin_rm_month: 10000, min_roi: 4 };

export async function runWeeklyReport(): Promise<{ ok: boolean; skipped?: string; margin_30d?: number; roi_30d?: number; on_track?: boolean }> {
  let target = DEFAULT_TARGET;
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "marketing_target").maybeSingle();
    const v = data?.value as { margin_rm_month?: number; min_roi?: number } | null;
    if (v && typeof v === "object") target = { ...DEFAULT_TARGET, ...v };
  } catch { /* default */ }

  const [m30, m7, paused] = await Promise.all([
    getEvaluation({ sinceDays: 30 }),
    getEvaluation({ sinceDays: 7 }),
    getPausedLoops(),
  ]);

  const margin30 = m30.totals.incremental_margin_rm;
  const roi30 = m30.totals.roi;
  const onTrackMargin = margin30 >= target.margin_rm_month;
  const onTrackRoi = roi30 >= target.min_roi;
  const rm = (v: number) => `RM${Math.round(v).toLocaleString()}`;

  const loopLines = m30.per_loop
    .filter((l) => l.sent > 0)
    .map((l) => {
      const flag = l.incremental_margin_rm > 0 ? "✅" : "🔻";
      const conf = l.holdout_n > 0 && l.holdout_n < 30 ? " (low conf)" : "";
      return `${flag} ${l.label}: ${l.avg_lift_pp > 0 ? "+" : ""}${l.avg_lift_pp}pp · ${rm(l.incremental_margin_rm)} · ${l.roi}×${conf}`;
    })
    .join("\n");

  const weekAgoMs = Date.now() - 7 * 86400000;
  const pausedEntries = Object.entries(paused);
  const newKills = pausedEntries.filter(([, v]) => new Date(v.at).getTime() >= weekAgoMs);
  const pausedLine = pausedEntries.length
    ? `⏸ Paused: ${pausedEntries.map(([k]) => k).join(", ")}${newKills.length ? ` — <b>${newKills.length} new this week</b> (${newKills.map(([k, v]) => `${k}: ${v.reason}`).join("; ")})` : ""}`
    : "⏸ Paused: none";

  const { count: inFlight } = await supabaseAdmin
    .from("loop_rounds").select("id", { count: "exact", head: true }).eq("status", "sent");

  const msg = [
    `📊 <b>SMS Loops — weekly report</b>`,
    `Target: <b>${rm(target.margin_rm_month)}/mo</b> incr margin @ <b>≥${target.min_roi}×</b>`,
    ``,
    `<b>30-day run-rate:</b> ${rm(margin30)} margin ${onTrackMargin ? "✅" : `⚠️ (${Math.round((margin30 / target.margin_rm_month) * 100)}% of target)`} · ${roi30}× blended ${onTrackRoi ? "✅" : "⚠️ below floor"}`,
    `<b>This week:</b> ${rm(m7.totals.incremental_margin_rm)} margin · ${m7.totals.sent.toLocaleString()} sends · ${rm(m7.totals.sms_cost_rm)} SMS · ${m7.totals.roi}×`,
    `(measured rounds only — ${inFlight ?? 0} rounds still in their window)`,
    ``,
    `<b>Loops, trailing 30d:</b>`,
    loopLines || "no measured rounds in window",
    ``,
    pausedLine,
  ].join("\n");

  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!chatRaw) return { ok: false, skipped: "TELEGRAM_OWNER_CHAT_ID not set" };
  const sent = await sendMessage(Number(chatRaw), msg);
  return { ok: sent.ok, margin_30d: margin30, roi_30d: roi30, on_track: onTrackMargin && onTrackRoi };
}
