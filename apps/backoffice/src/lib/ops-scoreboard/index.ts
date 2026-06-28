// Performance Scoreboard loop. The weekly 4DX scoreboard, delivered role-scoped
// over WhatsApp: each cashier gets their own numbers (DM), each leader gets the
// outlet league + per-outlet boards. Cadence of accountability, not a ping feed.
//
//   off    — cron no-op (kill switch).
//   shadow — DEFAULT. Build every board and LOG what it would send. No WhatsApp.
//   armed  — actually send. Cashier DMs + one leader digest to owner + ops leads.
//
// Independent of OPS_PULSE_MODE (OPS_SCOREBOARD_MODE), so the scoreboard can go
// live without touching the real-time pulse. Delivery is still bound by WhatsApp's
// 24h rule until the ops_scoreboard template is approved — so first arming should
// follow either template approval or a one-time "message the bot" onboarding.

import { resolvePeriod, computeScorecard, KPI_TARGETS } from "@/app/api/scorecard/route";
import { computeCashierBoards } from "./cashiers";
import { computeOpsHealth } from "./ops-health";
import { renderCashierBoard, renderManagerBoard, renderOwnerLeague, worstCashierOf } from "./render";
import { resolveRecipients, resolveOwner } from "@/lib/ops-pulse/router";
import { sendScoreboard } from "@/lib/ops-pulse/sender";

export type ScoreboardMode = "off" | "shadow" | "armed";

// Default ARMED (owner go-live 2026-06-28). Pause via OPS_SCOREBOARD_MODE=off|shadow.
export function scoreboardMode(): ScoreboardMode {
  const m = (process.env.OPS_SCOREBOARD_MODE || "armed").trim().toLowerCase();
  return m === "off" || m === "shadow" ? m : "armed";
}

function mask(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^0-9]/g, "");
  return d.length <= 4 ? "****" : `••••${d.slice(-4)}`;
}

export interface ScoreboardRunResult {
  mode: ScoreboardMode;
  ranAt: string;
  cashierBoards: number;
  leaderRecipients: number;
  sent: number;
}

export async function runScoreboard(now = new Date()): Promise<ScoreboardRunResult> {
  const mode = scoreboardMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, cashierBoards: 0, leaderRecipients: 0, sent: 0 };

  const p = resolvePeriod("last7days");
  const [sc, boards, health] = await Promise.all([
    computeScorecard(p),
    computeCashierBoards(p),
    computeOpsHealth(p),
  ]);
  const boardByOutletId = new Map(boards.map((b) => [b.outletId, b]));

  // ── Cashier DMs ──
  const cashierSends = boards.flatMap((b) =>
    b.cashiers
      .filter((c) => c.captureRate !== null)
      .map((c) => ({ to: c.phone, label: c.name, ...renderCashierBoard(c, b.crewCaptureRate, b.best, KPI_TARGETS) })),
  );

  // ── Leader digest (owner league + every outlet board, one message) ──
  const league = renderOwnerLeague(sc);
  const outletBlocks = sc.outlets
    .filter((o) => o.measurable > 0)
    .map((o) => renderManagerBoard(o, worstCashierOf(boardByOutletId.get(o.id)), health.get(o.id)).text);
  const leaderText = [league.text, "", "———", "", outletBlocks.join("\n\n———\n\n")].join("\n");
  const leaderVar = league.var;

  // Leader recipients: owner + ops discipline leads, de-duped by phone.
  const owner = await resolveOwner();
  const opsLeads = await resolveRecipients("operations");
  const leaderSeen = new Set<string>();
  const leaderSends: { to: string | null; label: string }[] = [];
  for (const a of [...(owner ? [owner] : []), ...opsLeads]) {
    const key = a.phone ? a.phone.replace(/[^0-9]/g, "").slice(-9) : a.name;
    if (leaderSeen.has(key)) continue;
    leaderSeen.add(key);
    leaderSends.push({ to: a.phone, label: a.name });
  }

  if (mode === "shadow") {
    for (const c of cashierSends) {
      console.log("[ops-scoreboard:shadow:cashier]", JSON.stringify({ to: c.label, phone: mask(c.to), summary: c.var }));
    }
    for (const l of leaderSends) {
      console.log("[ops-scoreboard:shadow:leader]", JSON.stringify({ to: l.label, phone: mask(l.to), summary: leaderVar }));
    }
    return { mode, ranAt, cashierBoards: cashierSends.length, leaderRecipients: leaderSends.length, sent: 0 };
  }

  // ── ARMED ──
  let sent = 0;
  for (const c of cashierSends) {
    if (!c.to) {
      console.warn(`[ops-scoreboard] no phone for cashier ${c.label} — skipped`);
      continue;
    }
    const res = await sendScoreboard(c.to, c.text, c.var);
    if (res.ok) sent += 1;
    else console.error(`[ops-scoreboard] cashier board to ${c.label} failed:`, res.error);
  }
  for (const l of leaderSends) {
    if (!l.to) {
      console.warn(`[ops-scoreboard] no phone for leader ${l.label} — skipped`);
      continue;
    }
    const res = await sendScoreboard(l.to, leaderText, leaderVar);
    if (res.ok) sent += 1;
    else console.error(`[ops-scoreboard] leader digest to ${l.label} failed:`, res.error);
  }

  return { mode, ranAt, cashierBoards: cashierSends.length, leaderRecipients: leaderSends.length, sent };
}
