// POST /api/finance/bills/upload
// Multipart upload of a supplier bill (PDF or image). Stores the file in
// the `finance-docs` Supabase storage bucket, then runs the AP agent which
// either auto-posts the bill or queues an exception.
//
// FormData:
//   file: File (PDF / JPEG / PNG / WEBP)
//   outletId?: string

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { ingestSupplierDoc } from "@/lib/finance/agents/ap";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "finance-docs";
const MAX_BYTES = 15 * 1024 * 1024;  // 15 MB
const ALLOWED: ReadonlyArray<"application/pdf" | "image/jpeg" | "image/png" | "image/webp"> = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const outletIdField = form.get("outletId");
  const outletId = typeof outletIdField === "string" && outletIdField ? outletIdField : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 413 });
  }
  const mime = file.type as (typeof ALLOWED)[number];
  if (!ALLOWED.includes(mime)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PDF, JPEG, PNG, or WEBP." },
      { status: 415 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Upload to Supabase storage. The file path is namespaced per upload to
  // dodge collisions; the AP agent stores the path on fin_documents.raw_url.
  const client = getFinanceClient();
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const path = `bills/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    cacheControl: "private",
  });
  if (uploadError) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  try {
    const result = await ingestSupplierDoc({
      fileBytes: bytes,
      mimeType: mime,
      storageUrl: path,
      uploadedById: auth.user.id,
      outletIdHint: outletId,
    });
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
