import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { parseBankStatementBuffer } from "@/lib/finance/bank-statement-parser";

// Accepts a CSV or XLSX upload, returns the parsed totals + period.
// The UI shows the result and lets Finance review/edit before saving.
// Doesn't persist anything — that's the POST /api/finance/bank-statements
// step after the user confirms.

export const runtime = "nodejs"; // xlsx needs Node, not edge

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

  const buf = Buffer.from(await file.arrayBuffer());
  const result = parseBankStatementBuffer(buf, file.name);
  return NextResponse.json({ ...result, fileName: file.name, fileSize: file.size });
}
