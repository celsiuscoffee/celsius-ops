// GET /api/finance/category-hints — what the categorizer has learned from
// manual classifications (payee phrase -> category). DELETE removes a hint
// that was learned wrong; the next full reclassify stops applying it.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  const client = getFinanceClient();
  const { data, error } = await client
    .from("fin_category_hints")
    .select("phrase, category, direction, source, hits, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hints: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  let body: { phrase?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.phrase) return NextResponse.json({ error: "phrase required" }, { status: 400 });
  const client = getFinanceClient();
  const { error } = await client.from("fin_category_hints").delete().eq("phrase", body.phrase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
