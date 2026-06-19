/**
 * Manual GrabAds spend entry — GrabAds (paid advertising) isn't in the Partner
 * API, so spend is keyed in from Grab's billing/payout statements.
 *
 * GET    /api/ads/grab/ad-spend?from=&to=&outletId=  → { entries[] }
 * POST   /api/ads/grab/ad-spend  { outletId, periodStart, periodEnd, amountMYR, note? }
 * DELETE /api/ads/grab/ad-spend?id=...
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

type SpendRow = {
  id: string;
  outlet_id: string;
  outlet_name: string | null;
  period_start: Date;
  period_end: Date;
  amount_sen: number;
  note: string | null;
  created_by: string | null;
  created_at: Date;
};

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId");
  const oFilter = outletId && outletId !== "all" ? outletId : null;
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from") : null;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to") : null;

  const rows = await prisma.$queryRaw<SpendRow[]>(Prisma.sql`
    SELECT s.id, s.outlet_id, o.name AS outlet_name, s.period_start, s.period_end,
           s.amount_sen, s.note, s.created_by, s.created_at
    FROM grab_ads_spend s
    LEFT JOIN outlets o ON o.id = s.outlet_id
    WHERE (${oFilter}::text IS NULL OR s.outlet_id = ${oFilter})
      AND (${from}::date IS NULL OR s.period_start >= ${from}::date)
      AND (${to}::date   IS NULL OR s.period_start <= ${to}::date)
    ORDER BY s.period_start DESC, s.created_at DESC
  `);

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      outletId: r.outlet_id,
      outletName: r.outlet_name ?? r.outlet_id,
      periodStart: r.period_start.toISOString().slice(0, 10),
      periodEnd: r.period_end.toISOString().slice(0, 10),
      amountMYR: r.amount_sen / 100,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    outletId?: string; periodStart?: string; periodEnd?: string; amountMYR?: number; note?: string;
  };
  const outletId = (body.outletId || "").trim();
  const { periodStart, periodEnd } = body;
  const amountMYR = Number(body.amountMYR);
  if (!outletId || !isDate(periodStart) || !isDate(periodEnd) || !Number.isFinite(amountMYR) || amountMYR < 0) {
    return NextResponse.json(
      { error: "outletId, periodStart, periodEnd (YYYY-MM-DD) and a non-negative amountMYR are required" },
      { status: 400 },
    );
  }
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "periodEnd must be on or after periodStart" }, { status: 400 });
  }
  const amountSen = Math.round(amountMYR * 100);
  const id = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO grab_ads_spend (id, outlet_id, period_start, period_end, amount_sen, note, created_by)
    VALUES (${id}, ${outletId}, ${periodStart}::date, ${periodEnd}::date, ${amountSen}, ${body.note ?? null}, ${user.name})
  `);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const n = await prisma.$executeRaw(Prisma.sql`DELETE FROM grab_ads_spend WHERE id = ${id}`);
  if (n === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
