import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "hr-documents";

// Supabase client factory — `any` return silences a type mismatch between
// the generated Database generic and the loose SupabaseClient we need here.
// We're only using the Storage API which is generic-agnostic.
type AnyClient = ReturnType<typeof createClient>;
function storageClient(): AnyClient {
  return createClient(supabaseUrl, supabaseKey);
}

// Ensure the private hr-documents bucket exists.
async function ensureBucket(client: AnyClient) {
  const { data: buckets } = await client.storage.listBuckets();
  if (!buckets?.find((b: { name: string }) => b.name === BUCKET)) {
    await client.storage.createBucket(BUCKET, { public: false });
  }
}

// Signs each stored doc's URL so callers can preview without making the
// bucket public. 1-hour lifetime is enough for any download flow.
async function signRows(
  client: AnyClient,
  rows: Array<{ storage_path: string } & Record<string, unknown>>,
) {
  const signed = await Promise.all(
    rows.map(async (r) => {
      const { data } = await client.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { ...r, signed_url: data?.signedUrl ?? null };
    }),
  );
  return signed;
}

// GET /api/hr/employee-documents?userId=…&type=loe
//   OWNER / ADMIN: any user. MANAGER: only their subtree. STAFF: themselves.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const targetUserId = searchParams.get("userId") || session.id;
  const typeFilter = searchParams.get("type");

  // Scope check
  if (session.role === "STAFF" && targetUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.role === "MANAGER") {
    const allowed = await resolveVisibleUserIds(session);
    const allowedSet = new Set([session.id, ...(allowed || [])]);
    if (!allowedSet.has(targetUserId)) {
      return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
    }
  }

  let q = hrSupabaseAdmin
    .from("hr_employee_documents")
    .select("*")
    .eq("user_id", targetUserId)
    .order("uploaded_at", { ascending: false });
  if (typeFilter) q = q.eq("doc_type", typeFilter);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ documents: data ?? [] });
  }
  const supabase = storageClient();
  const signed = await signRows(supabase, (data ?? []) as Array<{ storage_path: string }>);
  return NextResponse.json({ documents: signed });
}

// POST multipart/form-data:
//   user_id, doc_type, title?, note?, effective_date?, file
// OWNER / ADMIN only. MANAGERs can VIEW but not upload/edit (HR admin action).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const form = await req.formData();
  const userId = (form.get("user_id") as string | null)?.trim();
  const docType = (form.get("doc_type") as string | null)?.trim() || "other";
  const title = (form.get("title") as string | null)?.trim() || null;
  const note = (form.get("note") as string | null)?.trim() || null;
  const effectiveDate = (form.get("effective_date") as string | null)?.trim() || null;
  const file = form.get("file") as File | null;

  if (!userId || !file) {
    return NextResponse.json({ error: "user_id and file are required" }, { status: 400 });
  }
  const ALLOWED_TYPES = new Set(["loe", "coe", "contract", "nda", "confirmation", "resignation", "medical", "other"]);
  if (!ALLOWED_TYPES.has(docType)) {
    return NextResponse.json({ error: `Invalid doc_type: ${docType}` }, { status: 400 });
  }

  const supabase = storageClient();
  await ensureBucket(supabase);

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${userId}/${docType}/${stamp}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_employee_documents")
    .insert({
      user_id: userId,
      doc_type: docType,
      title,
      note,
      effective_date: effectiveDate,
      file_name: file.name,
      storage_path: storagePath,
      size_bytes: buffer.byteLength,
      mime_type: file.type || null,
      uploaded_by: session.id,
    })
    .select()
    .single();

  if (error) {
    // Roll back the upload if the DB insert failed
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return NextResponse.json({ document: { ...data, signed_url: signed?.signedUrl ?? null } });
}

// DELETE /api/hr/employee-documents?id=…
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await hrSupabaseAdmin
    .from("hr_employee_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  if (supabaseUrl && supabaseKey) {
    const supabase = storageClient();
    await supabase.storage.from(BUCKET).remove([existing.storage_path]);
  }
  await hrSupabaseAdmin.from("hr_employee_documents").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
