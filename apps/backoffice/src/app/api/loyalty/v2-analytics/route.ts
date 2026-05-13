// GET /api/loyalty/v2-analytics?brand_id=... — aggregate stats for the
// new rewards-v2 surfaces. One round-trip; the dashboard renders chips
// + bars off this single payload.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const brandId = new URL(request.url).searchParams.get("brand_id");
  if (!brandId) return NextResponse.json({ error: "brand_id is required" }, { status: 400 });

  // ── Missions ────────────────────────────────────────────────────
  const { data: missions } = await supabaseAdmin
    .from("reward_missions")
    .select("id, title, difficulty, total_picked, total_completed, is_active")
    .eq("brand_id", brandId);

  const missionRows = (missions ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    difficulty: m.difficulty,
    picked: m.total_picked ?? 0,
    completed: m.total_completed ?? 0,
    completion_rate: ((m.total_picked ?? 0) > 0
      ? Math.round(((m.total_completed ?? 0) / (m.total_picked as number)) * 100)
      : 0),
    is_active: m.is_active,
  }));

  // ── Mystery distribution ────────────────────────────────────────
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: drops } = await supabaseAdmin
    .from("mystery_drops")
    .select("outcome_type, revealed_at")
    .gte("created_at", since);

  const totalDrops = drops?.length ?? 0;
  const revealedDrops = (drops ?? []).filter((d) => d.revealed_at).length;
  const outcomeCount: Record<string, number> = {};
  for (const d of drops ?? []) {
    outcomeCount[d.outcome_type as string] = (outcomeCount[d.outcome_type as string] ?? 0) + 1;
  }
  const mysteryDistribution = Object.entries(outcomeCount).map(([type, count]) => ({
    type,
    count,
    pct: totalDrops > 0 ? Math.round((count / totalDrops) * 100) : 0,
  })).sort((a, b) => b.count - a.count);

  // ── Vouchers funnel ─────────────────────────────────────────────
  const { data: issued } = await supabaseAdmin
    .from("issued_rewards")
    .select("source_type, status")
    .gte("issued_at", since);

  const sourceFunnel: Record<string, { issued: number; redeemed: number; expired: number }> = {};
  for (const v of issued ?? []) {
    const k = (v.source_type as string) ?? "unknown";
    if (!sourceFunnel[k]) sourceFunnel[k] = { issued: 0, redeemed: 0, expired: 0 };
    sourceFunnel[k].issued++;
    // status 'used' is the consumed state for wallet vouchers — the DB
    // CHECK constraint only allows ('active','used','expired').
    if (v.status === "used") sourceFunnel[k].redeemed++;
    if (v.status === "expired")  sourceFunnel[k].expired++;
  }
  const voucherFunnel = Object.entries(sourceFunnel).map(([source, n]) => ({
    source,
    issued: n.issued,
    redeemed: n.redeemed,
    expired: n.expired,
    redemption_rate: n.issued > 0 ? Math.round((n.redeemed / n.issued) * 100) : 0,
  })).sort((a, b) => b.issued - a.issued);

  // ── Referrals ───────────────────────────────────────────────────
  const { data: attrs } = await supabaseAdmin
    .from("referral_attributions")
    .select("status, created_at")
    .eq("brand_id", brandId)
    .gte("created_at", since);

  const refSummary = {
    total: attrs?.length ?? 0,
    pending: (attrs ?? []).filter((a) => a.status === "pending").length,
    rewarded: (attrs ?? []).filter((a) => a.status === "rewarded").length,
    voided: (attrs ?? []).filter((a) => a.status === "voided").length,
  };

  // ── Streaks ─────────────────────────────────────────────────────
  const { data: streaks } = await supabaseAdmin
    .from("user_streaks")
    .select("current_streak_weeks");
  const streakBuckets = { zero: 0, b1to3: 0, b4to7: 0, b8plus: 0 };
  for (const s of streaks ?? []) {
    const n = (s.current_streak_weeks as number) ?? 0;
    if (n === 0) streakBuckets.zero++;
    else if (n <= 3) streakBuckets.b1to3++;
    else if (n <= 7) streakBuckets.b4to7++;
    else streakBuckets.b8plus++;
  }

  return NextResponse.json({
    range: { since, generated_at: new Date().toISOString() },
    missions: {
      total: missionRows.length,
      active: missionRows.filter((m) => m.is_active).length,
      rows: missionRows,
    },
    mystery: {
      total_drops: totalDrops,
      revealed: revealedDrops,
      reveal_rate: totalDrops > 0 ? Math.round((revealedDrops / totalDrops) * 100) : 0,
      distribution: mysteryDistribution,
    },
    vouchers: {
      total_issued: voucherFunnel.reduce((s, v) => s + v.issued, 0),
      total_redeemed: voucherFunnel.reduce((s, v) => s + v.redeemed, 0),
      by_source: voucherFunnel,
    },
    referrals: refSummary,
    streaks: {
      zero: streakBuckets.zero,
      "1_3": streakBuckets.b1to3,
      "4_7": streakBuckets.b4to7,
      "8_plus": streakBuckets.b8plus,
    },
  });
}
