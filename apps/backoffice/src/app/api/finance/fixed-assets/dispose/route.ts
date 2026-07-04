// POST /api/finance/fixed-assets/dispose: { id, disposedOn }
// Marks the asset disposed and stops future depreciation (the disposal month
// and every later month take no charge; see the convention in
// lib/finance/fixed-assets.ts). v1 keeps disposal simple: NO gain or loss
// journal is posted and the asset cost stays on the books until a proper
// disposal journal is added. Owner/Admin only.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { id?: string; disposedOn?: string } = {};
  try { body = (await req.json()) ?? {}; } catch { /* validated below */ }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!body.disposedOn || !/^\d{4}-\d{2}-\d{2}$/.test(body.disposedOn)) {
    return NextResponse.json({ error: "disposedOn must be YYYY-MM-DD" }, { status: 400 });
  }

  const client = getFinanceClient();
  const { data: row } = await client
    .from("fin_fixed_assets").select("id, status, acquired_date").eq("id", body.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (row.status === "disposed") return NextResponse.json({ error: "Asset already disposed" }, { status: 409 });
  if (body.disposedOn < (row.acquired_date as string)) {
    return NextResponse.json({ error: "disposedOn cannot be before the acquisition date" }, { status: 400 });
  }

  await client.rpc("fin_set_actor", { p_actor: auth.user.id }).then(() => undefined, () => undefined);
  const { error } = await client
    .from("fin_fixed_assets")
    .update({ status: "disposed", disposed_date: body.disposedOn, updated_at: new Date().toISOString() })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
