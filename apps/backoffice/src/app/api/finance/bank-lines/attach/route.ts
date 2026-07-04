// Attachments for a bank line — the supporting invoice / receipt / charge
// advice behind a manual reconciliation. Especially for bank fees and other
// expenses that have no procurement invoice, this is the audit trail.
//
// POST  multipart { file, bankLineId }  → upload to finance-docs, record in
//       fin_documents (source_ref = bankLineId, doc_type = bank_line_attachment)
// GET   ?bankLineId=…                    → list attachments with signed view URLs
// DELETE { documentId }                  → remove an attachment

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "finance-docs";
const DOC_TYPE = "bank_line_attachment";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

async function guard(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

// Company for a bank line, from its statement account-name suffix (same mapping
// the GL bridge uses): 2644 = Conezion, 9345 = Tamarind, else the default co.
async function companyForBankLine(bankLineId: string): Promise<{ companyId: string; outletId: string | null } | null> {
  const line = await prisma.bankStatementLine.findUnique({
    where: { id: bankLineId },
    select: { outletId: true, statement: { select: { accountName: true } } },
  });
  if (!line) return null;
  const acct = line.statement?.accountName ?? "";
  const companyId = acct.includes("2644") ? "celsiusconezion" : acct.includes("9345") ? "celsiustamarind" : "celsius";
  return { companyId, outletId: line.outletId ?? null };
}

export async function POST(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;

  const form = await req.formData();
  const file = form.get("file");
  const bankLineId = form.get("bankLineId");
  if (typeof bankLineId !== "string" || !bankLineId) {
    return NextResponse.json({ error: "bankLineId required" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 413 });
  const mime = file.type as (typeof ALLOWED)[number];
  if (!ALLOWED.includes(mime)) {
    return NextResponse.json({ error: "Use PDF, JPEG, PNG or WEBP" }, { status: 415 });
  }

  const co = await companyForBankLine(bankLineId);
  if (!co) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });

  const client = getFinanceClient();
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const path = `bank-line/${bankLineId}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await client.storage.from(BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "private" });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data, error } = await client.from("fin_documents").insert({
    source: "manual_upload",
    source_ref: bankLineId,
    doc_type: DOC_TYPE,
    outlet_id: co.outletId,
    company_id: co.companyId,
    raw_url: path,
    status: "attached",
    metadata: { filename: file.name, mime, size: file.size },
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, documentId: data.id, filename: file.name });
}

export async function GET(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  const bankLineId = new URL(req.url).searchParams.get("bankLineId");
  if (!bankLineId) return NextResponse.json({ error: "bankLineId required" }, { status: 400 });

  const client = getFinanceClient();
  const { data, error } = await client
    .from("fin_documents")
    .select("id, raw_url, metadata, created_at")
    .eq("doc_type", DOC_TYPE)
    .eq("source_ref", bankLineId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Signed URLs so the private bucket is viewable for a short window.
  const rows = await Promise.all((data ?? []).map(async (d) => {
    const { data: signed } = await client.storage.from(BUCKET).createSignedUrl(d.raw_url as string, 3600);
    const meta = (d.metadata ?? {}) as { filename?: string };
    return { id: d.id, filename: meta.filename ?? "attachment", url: signed?.signedUrl ?? null, createdAt: d.created_at };
  }));
  return NextResponse.json({ attachments: rows });
}

export async function DELETE(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  let body: { documentId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  const client = getFinanceClient();
  const { data: doc } = await client.from("fin_documents").select("raw_url").eq("id", body.documentId).eq("doc_type", DOC_TYPE).maybeSingle();
  if (doc?.raw_url) await client.storage.from(BUCKET).remove([doc.raw_url as string]);
  const { error } = await client.from("fin_documents").delete().eq("id", body.documentId).eq("doc_type", DOC_TYPE);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
