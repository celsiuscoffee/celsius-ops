import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

// Server-side validation matters even though our UI restricts the
// picker — anyone can hit the endpoint directly with curl. Without
// these checks an attacker could fill the bucket with arbitrary
// files (cost + storage limits) or upload an HTML/SVG that gets
// served from our domain (XSS).
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — bigger than the 5 MB on staff so PDFs/multi-page invoices fit
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export async function POST(req: NextRequest) {
  // Auth check — previously this endpoint accepted anonymous uploads
  // to a PUBLIC Supabase bucket, which was a wide open door.
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string | null) ?? "invoices";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Size check — before reading the body so we don't allocate huge buffers
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    // Mime allowlist — image formats and PDF only
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || "unknown"}` },
        { status: 415 },
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const buffer = Buffer.from(await file.arrayBuffer());
    const isPdf = file.type === "application/pdf";
    const ext = isPdf ? "pdf" : file.name.split(".").pop() || "jpg";
    // Generated filenames only — never trust the user-supplied name
    // (path traversal, XSS via filename, etc.).
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Ensure bucket exists
    const bucketName = "invoices";
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === bucketName)) {
      await supabase.storage.createBucket(bucketName, { public: true });
    }

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, buffer, {
        contentType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
        upsert: true,
      });

    if (uploadError) {
      console.error("[upload] Supabase error:", uploadError.message);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);

    return NextResponse.json({
      url: urlData.publicUrl,
      type: isPdf ? "pdf" : "image",
      name: file.name,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[upload] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
