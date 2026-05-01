import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { requireAuth } from "@/lib/auth";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// Server-side validation. Without these checks anyone could fill our
// Cloudinary plan with arbitrary uploads.
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * POST /api/pickup/upload-image
 * Accepts multipart/form-data with a "file" field.
 * Uploads to Cloudinary under celsius-coffee/products/{productId}.
 * Auth required; image-only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const productId = (formData.get("productId") as string | null) ?? "misc";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  // Sanitize productId (used as part of the Cloudinary public_id) —
  // strip anything that could escape the celsius-coffee/products/ path.
  const safeProductId = productId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);

  // Sanitize the override too. A caller that specifies their own
  // public_id can still control the leaf name + an optional sub-path,
  // but only within celsius-coffee/products/. Without this, an
  // authenticated user could overwrite ANY asset under our cloud
  // (e.g. `celsius-coffee/banners/homepage`).
  const publicIdRaw = formData.get("publicId") as string | null;
  const safeOverride = publicIdRaw
    ? `celsius-coffee/products/${publicIdRaw.replace(/[^a-zA-Z0-9_/-]/g, "_").slice(0, 200)}`
    : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(base64, {
    public_id:    safeOverride ?? `celsius-coffee/products/${safeProductId}`,
    overwrite:    true,
    resource_type: "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  });

  return NextResponse.json({ url: result.secure_url });
}
