import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { actualWeekRevenue, gateSchedule } from "@/lib/hr/labour-gate";
import { resolveOwner } from "@/lib/ops-pulse/router";
import { sendManagerDigest } from "@/lib/ops-pulse/sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/labour-variance — Monday-morning actuals-vs-plan labour digest,
// the "measure" step of the people-cost gating loop
// (docs/design/people-cost-gating-loop.md).
//
// For each active outlet's just-completed week (Mon–Sun): what the published
// roster promised (estimated_labor_cost as % of forecast) vs what actually
// happened (same cost over ACTUAL revenue). A gap of more than ~2pts means the
// forecast missed or shifts changed after publish — either way, next week's
// roster needs adjusting, and that is the conversation this digest starts.
//
// Controlled by LABOUR_VARIANCE_MODE (off | shadow | armed); ships in SHADOW —
// logs the digest it would send, sends nothing — until the output is reviewed.

type Mode = "off" | "shadow" | "armed";
function mode(): Mode {
  const m = (process.env.LABOUR_VARIANCE_MODE || "shadow").trim().toLowerCase();
  return m === "off" || m === "armed" ? (m as Mode) : "shadow";
}

// Monday of the most recent COMPLETED week, in MYT.
function lastWeekMonday(now: Date): string {
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  const dow = (myt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  myt.setUTCDate(myt.getUTCDate() - dow - 7);
  return myt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const runMode = mode();
  if (runMode === "off") return NextResponse.json({ ok: true, mode: runMode, lines: [] });

  const weekStart = lastWeekMonday(new Date());
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", loyaltyOutletId: { not: null } },
    select: { id: true, name: true, loyaltyOutletId: true },
  });

  const lines: string[] = [];
  for (const outlet of outlets) {
    const { data: schedule } = await hrSupabaseAdmin
      .from("hr_schedules")
      .select("id, status, estimated_labor_cost")
      .eq("outlet_id", outlet.id)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (!schedule) continue; // outlet doesn't roster through the system (yet) — the leak the gate closes over time

    // Prefer the cost stamped at publish; fall back to repricing the stored
    // shifts (covers pre-gate weeks where the column is empty).
    let plannedCost = Number(schedule.estimated_labor_cost) || 0;
    let plannedPct: number | null = null;
    if (!plannedCost) {
      const gate = await gateSchedule(outlet.id, weekStart);
      plannedCost = gate.rosterCost;
      plannedPct = gate.pct;
    }

    const revenue = await actualWeekRevenue(outlet.loyaltyOutletId, weekStart);
    if (revenue <= 0 && !plannedCost) continue;

    const actualPct = revenue > 0 ? plannedCost / revenue : null;
    const fmtPct = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
    const status = schedule.status === "published" ? "" : ` (${schedule.status}!)`;
    lines.push(
      `${outlet.name}${status}: labour RM${Math.round(plannedCost).toLocaleString()} on RM${Math.round(revenue).toLocaleString()} rev = ${fmtPct(actualPct)}${
        plannedPct != null ? ` (planned ${fmtPct(plannedPct)})` : ""
      }`,
    );
  }

  if (lines.length === 0) {
    console.log(`[cron/labour-variance] week ${weekStart}: no rostered outlets`);
    return NextResponse.json({ ok: true, mode: runMode, weekStart, lines });
  }

  const header = `Labour last week (${weekStart}):`;
  if (runMode === "shadow") {
    console.log(`[cron/labour-variance:shadow] ${header}\n${lines.join("\n")}`);
    return NextResponse.json({ ok: true, mode: runMode, weekStart, lines });
  }

  const owner = await resolveOwner();
  let sent = 0;
  if (owner?.phone) {
    const res = await sendManagerDigest(owner.phone, [header, ...lines]);
    if (res.ok) sent += 1;
    else console.error("[cron/labour-variance] owner send failed:", res.error);
  } else {
    console.warn("[cron/labour-variance] no owner phone on file — digest not sent");
  }
  return NextResponse.json({ ok: true, mode: runMode, weekStart, lines, sent });
}
