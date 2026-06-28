// WhatsApp renderers for the role-scoped performance scoreboard. Three boards:
//   - cashier  (DM): your capture + upsell vs target, vs crew, vs the top performer.
//   - manager  (per outlet): the outlet roll-up across all KPIs + who to coach.
//   - owner    (league): outlets ranked, the cross-outlet picture.
//
// Each returns { text, var }: `text` is the full multi-line free-form body
// (delivered in-window); `var` is the single-line {{1}} for the approved
// ops_scoreboard template (newline-free) — same dual-rendering as the pulse.

import type { computeScorecard } from "@/app/api/scorecard/route";
import type { CashierRow, OutletCashierBoard } from "./cashiers";
import { type OutletOpsHealth, CLOCKIN_TARGET_PCT, STOCK_MAX_DAYS } from "./ops-health";

type Scorecard = Awaited<ReturnType<typeof computeScorecard>>;
export type OutletRow = Scorecard["outlets"][number];

const tick = (s: string) => (s === "hit" ? "✓" : s === "miss" ? "✗" : "·");

function pct(v: number | null): string {
  return v === null ? "n/a" : `${v}%`;
}

// ── Cashier board (DM) ───────────────────────────────────────────────────
export function renderCashierBoard(
  c: CashierRow,
  crewCaptureRate: number | null,
  best: CashierRow | null,
  targets: { collectionRate: number; upsellRate: number },
): { text: string; var: string } {
  const capOk = c.captureRate !== null && c.captureRate >= targets.collectionRate;
  const upOk = c.upsellRate !== null && c.upsellRate >= targets.upsellRate;
  const lines = [
    `Your scoreboard — ${c.name}`,
    "",
    `Phone capture: ${pct(c.captureRate)} (target ${targets.collectionRate}%) ${capOk ? "✓" : "✗"}`,
    `Upsell: ${pct(c.upsellRate)} (target ${targets.upsellRate}%) ${upOk ? "✓" : "✗"}`,
    "",
  ];
  const ctx: string[] = [];
  if (crewCaptureRate !== null) ctx.push(`Crew avg ${crewCaptureRate}%`);
  if (best && best.employeeId !== c.employeeId && best.captureRate !== null)
    ctx.push(`top: ${best.name.split(" ")[0]} ${best.captureRate}%`);
  if (ctx.length) lines.push(ctx.join(" · "));
  lines.push('Ask every customer "nombor untuk points?" — small ask, big number.');
  const v = `capture ${pct(c.captureRate)} (tgt ${targets.collectionRate}%) · upsell ${pct(c.upsellRate)} (tgt ${targets.upsellRate}%)${crewCaptureRate !== null ? ` · crew ${crewCaptureRate}%` : ""}${best && best.captureRate !== null ? ` · top ${best.name.split(" ")[0]} ${best.captureRate}%` : ""}`;
  return { text: lines.join("\n"), var: v };
}

// ── Manager board (per outlet) ───────────────────────────────────────────
export function renderManagerBoard(
  o: OutletRow,
  worstCashier: CashierRow | null,
  health?: OutletOpsHealth,
): { text: string; var: string } {
  const k = o.kpis;
  const rows: Array<[string, string]> = [
    ["Capture", `${pct(k.collection.value)} (tgt ${k.collection.target}%) ${tick(k.collection.status)}`],
    ["Serving", `${k.serving.value === null ? "n/a" : `${k.serving.value}m`} (tgt ${k.serving.target}m) ${tick(k.serving.status)}`],
    ["Checklist", `${pct(k.ops.value)} (tgt ${k.ops.target}%) ${tick(k.ops.status)}`],
    ["Wastage", `${k.wastage.value === null ? "n/a" : `${k.wastage.value}%`} (tgt ${k.wastage.target}%) ${tick(k.wastage.status)}`],
    ["Upsell", `${pct(k.upsell.value)} (tgt ${k.upsell.target}%) ${tick(k.upsell.status)}`],
  ];
  // Dark-signal adoption metrics — owned numbers, not per-incident pings.
  if (health) {
    const ciStatus = health.clockInPct === null ? "·" : health.clockInPct >= CLOCKIN_TARGET_PCT ? "✓" : "✗";
    rows.push(["Clock-in", `${health.clockInPct === null ? "n/a" : `${health.clockInPct}%`} (tgt ${CLOCKIN_TARGET_PCT}%) ${ciStatus}`]);
    const scStatus = health.daysSinceCount === null ? "✗" : health.daysSinceCount <= STOCK_MAX_DAYS ? "✓" : "✗";
    const scVal = health.daysSinceCount === null ? "never" : `${health.daysSinceCount}d ago`;
    rows.push(["Stock count", `${scVal} (tgt ≤${STOCK_MAX_DAYS}d) ${scStatus}`]);
  }
  const lines = [
    `Outlet scoreboard — ${o.name} (this week)`,
    "",
    ...rows.map(([label, val]) => `${label}: ${val}`),
    "",
    `Score: ${o.met}/${o.measurable} KPIs hit.`,
  ];
  if (worstCashier && worstCashier.captureRate !== null) {
    lines.push(`Coach this week: ${worstCashier.name} at ${worstCashier.captureRate}% capture.`);
  }
  const healthVar = health
    ? ` · clock-in ${health.clockInPct === null ? "n/a" : `${health.clockInPct}%`} · stock ${health.daysSinceCount === null ? "never" : `${health.daysSinceCount}d`}`
    : "";
  const v = `${o.name}: ${o.met}/${o.measurable} hit · capture ${pct(k.collection.value)} · serving ${k.serving.value === null ? "n/a" : `${k.serving.value}m`} · checklist ${pct(k.ops.value)} · wastage ${k.wastage.value === null ? "n/a" : `${k.wastage.value}%`} · upsell ${pct(k.upsell.value)}${healthVar}`;
  return { text: lines.join("\n"), var: v };
}

// ── Owner league table ───────────────────────────────────────────────────
export function renderOwnerLeague(sc: Scorecard): { text: string; var: string } {
  const ranked = sc.outlets.filter((o) => o.measurable > 0);
  const lines = [
    `Outlet league — ${sc.period.label}`,
    "",
    ...ranked.map((o, i) => `${i + 1}. ${o.name} — ${o.score}% (${o.met}/${o.measurable})`),
    "",
    `Avg capture ${pct(sc.summary.avg.collection)} (tgt ${sc.targets.collectionRate}%). ${sc.summary.hittingAll}/${sc.summary.measuredOutlets} outlets hitting every KPI.`,
  ];
  const v = `${ranked.map((o) => `${o.name} ${o.score}%`).join(" · ")} · avg capture ${pct(sc.summary.avg.collection)}`;
  return { text: lines.join("\n"), var: v };
}

// Helper: the worst-capture cashier on a board (the coaching target), with enough
// volume to be fair. cashiers[] is already sorted worst-first.
export function worstCashierOf(board: OutletCashierBoard | undefined): CashierRow | null {
  if (!board) return null;
  const eligible = board.cashiers.filter((c) => c.captureRate !== null);
  return eligible.length ? eligible[0] : null;
}
