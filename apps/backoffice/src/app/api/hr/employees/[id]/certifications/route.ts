import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set([
  "food_handler",        // Sijil Pengendali Makanan — required by MOH for F&B
  "halal",               // JAKIM halal awareness
  "first_aid",
  "fire_safety",         // Bomba SKAB
  "barista",             // SCA / barista skills
  "license",             // motorbike, lorry, forklift
  "other",
]);

// GET /api/hr/employees/[id]/certifications — list one staff's certs.
// Annotates each row with `days_to_expiry` so the UI can pick a colour
// without recomputing client-side.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // MANAGER: subtree only — cert numbers and attachments are personal data.
  if (session.role === "MANAGER") {
    const visible = await resolveVisibleUserIds(session);
    if (!(visible || []).includes(id)) {
      return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_certifications")
    .select("*")
    .eq("user_id", id)
    .order("expires_at", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const enriched = (data || []).map((c: { expires_at: string | null; [k: string]: unknown }) => {
    let days_to_expiry: number | null = null;
    if (c.expires_at) {
      const exp = new Date(c.expires_at + "T00:00:00Z");
      days_to_expiry = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
    }
    return { ...c, days_to_expiry };
  });
  return NextResponse.json({ certifications: enriched });
}

// POST — create a new cert record.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const {
    cert_type, name, issuer, cert_number,
    issued_date, expires_at, attachment_url, attachment_path, notes,
  } = body || {};

  if (!cert_type || !name) {
    return NextResponse.json({ error: "cert_type and name required" }, { status: 400 });
  }
  if (!VALID_TYPES.has(cert_type)) {
    return NextResponse.json({ error: `Invalid cert_type: ${cert_type}` }, { status: 400 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_certifications")
    .insert({
      user_id: id,
      cert_type,
      name,
      issuer: issuer || null,
      cert_number: cert_number || null,
      issued_date: issued_date || null,
      expires_at: expires_at || null,
      attachment_url: attachment_url || null,
      attachment_path: attachment_path || null,
      notes: notes || null,
      created_by: session.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certification: data });
}

// PATCH — edit a cert (typically to extend expires_at after renewal).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const { cert_id, ...patchable } = body || {};
  if (!cert_id) return NextResponse.json({ error: "cert_id required" }, { status: 400 });

  const allowed = [
    "name", "issuer", "cert_number", "issued_date", "expires_at",
    "attachment_url", "attachment_path", "notes",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // Use ?? not || so legitimate empty strings / zeros don't get clobbered to null.
  for (const k of allowed) if (k in patchable) patch[k] = patchable[k] ?? null;

  // If expiry got pushed out, clear past reminders so the cron can re-fire
  // when the new date approaches its next stage.
  if ("expires_at" in patchable && patchable.expires_at) {
    await hrSupabaseAdmin.from("hr_certification_reminders").delete().eq("certification_id", cert_id);
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_certifications")
    .update(patch)
    .eq("id", cert_id)
    .eq("user_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certification: data });
}

// DELETE — remove a cert (typo / wrong staff).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const certId = new URL(req.url).searchParams.get("cert_id");
  if (!certId) return NextResponse.json({ error: "cert_id required" }, { status: 400 });
  const { error } = await hrSupabaseAdmin
    .from("hr_certifications")
    .delete()
    .eq("id", certId)
    .eq("user_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
