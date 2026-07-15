import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Leave attachments (e.g. medical certificates) are health PII, so they live in
// the PRIVATE hr-documents bucket — the same store as LOEs/contracts — under a
// reserved `_leave/` prefix (mirroring `_company/` for signatures). We store the
// object PATH on hr_leave_requests.attachment_url and sign it on read; the file
// is never publicly reachable. Service-role client bypasses the bucket's
// no-policy RLS. Same Supabase project as the hr_* tables (kqdc).
const BUCKET = "hr-documents";
const PREFIX = "_leave";
const MAX_SIZE = 10 * 1024 * 1024; // 10MB — MCs are sometimes multi-page PDF scans
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/**
 * POST /api/hr/leave/attachment
 * Upload a supporting document for a leave request (medical cert, slip, etc.).
 * multipart/form-data with a "file" field. Returns { path, signed_url }.
 * The caller then passes `path` as `attachment_url` in the leave POST body.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Only images (JPG/PNG/WEBP/HEIC) or PDF are allowed" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Path is scoped to the uploader so a staffer can only ever write under their
  // own id; the leave POST re-derives user_id from the session, never the path.
  const path = `${PREFIX}/${session.id}/${stamp}.${ext || "bin"}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  // Return a short-lived signed URL so the form can show a preview/confirmation.
  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  return NextResponse.json({ path, signed_url: signed?.signedUrl ?? null });
}
