import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";
import { parseMaybankStatementText } from "@/lib/finance/maybank-statement-parser";
import { extractMaybankText } from "@/lib/finance/maybank-pdf-extract";
import { persistMaybankStatement } from "@/lib/finance/persist-bank-statement";

// Ingests a Maybank PDF statement: extract → parse → classify → persist
// (idempotent). Two callers:
//   • In-app drag-drop  → multipart `file` (PDF), authed by ADMIN session.
//   • Local watcher      → JSON { text, fileName } (pdftotext output), authed
//                          by `Bearer ${CRON_SECRET}`.
// The watcher pre-extracts text locally (pdftotext) so the server doesn't have
// to run pdfjs on every upload; the UI path extracts server-side via unpdf.

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;
// Attribution for headless (watcher) ingests — overridable via env.
const SYSTEM_UPLOADER = process.env.FINANCE_SYSTEM_USER_ID ?? "213c5fb5-06ab-47c5-aa5f-a737dadaedf8";

function metaFromName(name?: string | null): { accountNumber?: string; statementDate?: string } {
  const m = (name ?? "").match(/_(\d{12})_(\d{4}-\d{2}-\d{2})\./);
  return { accountNumber: m?.[1], statementDate: m?.[2] };
}

export async function POST(req: NextRequest) {
  // Headless watcher (Bearer FINANCE_INGEST_SECRET) or ADMIN session (UI).
  let uploaderId = SYSTEM_UPLOADER;
  const secret = process.env.FINANCE_INGEST_SECRET;
  const authed = !!secret && (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
  if (!authed) {
    try {
      const user = await requireRole(req.headers, "ADMIN");
      uploaderId = user.id;
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
      return NextResponse.json({ error: "Auth error" }, { status: 500 });
    }
  }

  const ctype = req.headers.get("content-type") ?? "";
  let text: string;
  let fileName: string | null = null;

  try {
    if (ctype.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
      }
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        return NextResponse.json(
          { error: "This endpoint takes Maybank PDFs. For CSV/XLSX use the spreadsheet upload." },
          { status: 415 }
        );
      }
      fileName = file.name;
      text = await extractMaybankText(new Uint8Array(await file.arrayBuffer()));
    } else {
      const body = (await req.json().catch(() => null)) as { text?: string; fileName?: string } | null;
      if (!body?.text) return NextResponse.json({ error: "Provide a PDF file or JSON { text }" }, { status: 400 });
      text = body.text;
      fileName = body.fileName ?? null;
    }
  } catch (e) {
    return NextResponse.json({ error: `Could not read upload: ${e instanceof Error ? e.message : "error"}` }, { status: 400 });
  }

  const parsed = parseMaybankStatementText(text, metaFromName(fileName));
  if (parsed.rowsParsed === 0) {
    return NextResponse.json(
      { error: "No transactions found — is this a Maybank current-account statement?", warnings: parsed.warnings },
      { status: 422 }
    );
  }

  const result = await persistMaybankStatement(prisma, parsed, {
    uploadedById: uploaderId,
    sourceFileName: fileName,
  });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
