import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "ads-pop";

// Mime allowlist — POP receipts are images or PDFs only.
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
]);
const MAX_BYTES = 15 * 1024 * 1024;

function getStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

// POST /api/ads/payments/[id]/pop — multipart upload of POP image
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.adsPayment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  const ext = file.name.split(".").pop() || "jpg";
  const path = `${existing.yearMonth}/${id}/${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const supabase = getStorage();
  // Ensure bucket exists (idempotent)
  await supabase.storage.createBucket(BUCKET, { public: false }).catch(() => {});

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });

  if (error) {
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }

  await prisma.adsPayment.update({
    where: { id },
    data: { popPhotos: [...existing.popPhotos, path] },
  });

  return NextResponse.json({ path });
}

// GET /api/ads/payments/[id]/pop?path=... — signed URL to view
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const existing = await prisma.adsPayment.findUnique({ where: { id } });
  if (!existing || !existing.popPhotos.includes(path)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = getStorage();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return NextResponse.json({ error: "Signing failed" }, { status: 500 });

  return NextResponse.json({ url: data.signedUrl, expiresIn: 3600 });
}
