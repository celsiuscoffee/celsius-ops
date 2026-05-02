// GET /api/finance/reports/auditor-pack?fiscalYear=2026&companyId=...
// Returns a manifest of CSV files. The browser fetches each file separately
// from /api/finance/reports/auditor-pack/file?... using its index. A future
// iteration will stream these as a ZIP via @zip.js.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildAuditorPack } from "@/lib/finance/reports/auditor-pack";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const fiscalYear = Number(url.searchParams.get("fiscalYear") ?? new Date().getUTCFullYear());
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());

  try {
    const files = await buildAuditorPack({ companyId, fiscalYear });
    // Inline-encode the CSVs as data URLs so the browser can save each.
    return NextResponse.json({
      companyId,
      fiscalYear,
      files: files.map((f) => ({
        filename: f.filename,
        size: f.csv.length,
        dataUrl: `data:text/csv;base64,${Buffer.from(f.csv).toString("base64")}`,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
