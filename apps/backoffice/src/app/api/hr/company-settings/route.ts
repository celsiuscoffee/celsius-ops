import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "hr-documents";
const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

export async function GET() {
  const session = await getSession();
  // OWNER/ADMIN only — returns employer statutory IDs + a signed URL of the
  // authorised-signatory signature image (forgery risk if wider). All callers
  // are HR Settings pages, which are already OWNER/ADMIN.
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await hrSupabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sign the signature URL so the settings page can preview it without
  // exposing the underlying private bucket.
  let signature_url: string | null = null;
  const path = (data as { confirmation_signature_path?: string | null } | null)?.confirmation_signature_path;
  if (path && supabaseUrl && supabaseKey) {
    const client = createClient(supabaseUrl, supabaseKey);
    const { data: signed } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
    signature_url = signed?.signedUrl ?? null;
  }

  return NextResponse.json({ settings: data, signature_url });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { data, error } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
