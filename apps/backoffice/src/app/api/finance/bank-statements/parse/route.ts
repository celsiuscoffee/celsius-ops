import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { parseBankStatementBuffer } from "@/lib/finance/bank-statement-parser";

// Accepts a CSV or XLSX upload, returns the parsed totals + period.
// The UI shows the result and lets Finance review/edit before saving.
// Doesn't persist anything — that's the POST /api/finance/bank-statements
// step after the user confirms.

export const runtime = "nodejs"; // xlsx needs Node, not edge

// Server-side validation: xlsx parses arbitrary buffers and has had
// CVEs (CVE-2023-30533 etc.) — capping size + restricting mime
// limits attack surface even though the route is admin-only.
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — bank statements can be heavy
const ALLOWED_MIME = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // some browsers send this for .csv
  "",                          // and some send empty type
]);

export async function POST(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 }); }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type) && !/\.(csv|xlsx?|tsv)$/i.test(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}. Expected CSV or Excel.` },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = parseBankStatementBuffer(buf, file.name);
  return NextResponse.json({ ...result, fileName: file.name, fileSize: file.size });
}
