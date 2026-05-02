// GET /api/finance/exceptions/:id
// Returns the exception + the source document (with a signed URL for image
// PDFs so the inbox UI can preview the bill in the drawer).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "finance-docs";
const SIGNED_TTL = 60 * 10;  // 10 minutes — long enough to review, not pinnable

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const client = getFinanceClient();

  const { data: exc, error } = await client
    .from("fin_exceptions")
    .select(
      "id, type, related_type, related_id, agent, reason, proposed_action, priority, status, created_at, resolved_at, resolution"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!exc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  type Doc = {
    id: string;
    source: string;
    source_ref: string;
    doc_type: string;
    raw_url: string | null;
    signed_url: string | null;
    metadata: unknown;
    received_at: string;
  };
  let document: Doc | null = null;

  if (exc.related_type === "document" && exc.related_id) {
    const { data: doc } = await client
      .from("fin_documents")
      .select("id, source, source_ref, doc_type, raw_url, metadata, received_at")
      .eq("id", exc.related_id as string)
      .maybeSingle();
    if (doc) {
      let signed: string | null = null;
      if (doc.raw_url) {
        const { data: signedRes } = await client.storage
          .from(BUCKET)
          .createSignedUrl(doc.raw_url as string, SIGNED_TTL);
        signed = signedRes?.signedUrl ?? null;
      }
      document = {
        id: doc.id as string,
        source: doc.source as string,
        source_ref: doc.source_ref as string,
        doc_type: doc.doc_type as string,
        raw_url: (doc.raw_url as string) ?? null,
        signed_url: signed,
        metadata: doc.metadata,
        received_at: doc.received_at as string,
      };
    }
  }

  return NextResponse.json({ exception: exc, document });
}
