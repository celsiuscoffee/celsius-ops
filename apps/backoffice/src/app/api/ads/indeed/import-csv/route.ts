import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importIndeedCsv } from "@/lib/indeed/import-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/indeed/import-csv
// multipart/form-data: file (CSV), periodStart (YYYY-MM-DD), periodEnd (YYYY-MM-DD)
export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file        = form.get("file");
  const periodStart = form.get("periodStart");
  const periodEnd   = form.get("periodEnd");

  if (!(file instanceof File))                return NextResponse.json({ error: "file (CSV) required" }, { status: 400 });
  if (typeof periodStart !== "string" || !periodStart) return NextResponse.json({ error: "periodStart required (YYYY-MM-DD)" }, { status: 400 });
  if (typeof periodEnd   !== "string" || !periodEnd)   return NextResponse.json({ error: "periodEnd required (YYYY-MM-DD)" }, { status: 400 });

  const csvText = await file.text();

  const log = await prisma.indeedAdsSyncLog.create({
    data: { kind: "csv-import", status: "running" },
  });

  try {
    const result = await importIndeedCsv({
      csvText,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
    });

    await prisma.indeedAdsSyncLog.update({
      where: { id: log.id },
      data:  {
        status:       result.errors.length > 0 ? "ok" : "ok",
        finishedAt:   new Date(),
        rowsUpserted: result.jobsUpserted + result.metricsUpserted,
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : null,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.indeedAdsSyncLog.update({
      where: { id: log.id },
      data:  { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
