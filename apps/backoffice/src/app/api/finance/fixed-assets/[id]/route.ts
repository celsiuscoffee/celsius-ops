// PATCH /api/finance/fixed-assets/[id]: edit name, useful life, residual,
// PP&E account, outlet or notes. Owner/Admin only. No recompute step needed:
// depreciation is derived from the row on every read, so edits take effect
// everywhere immediately (register, P&L line, auditor pack). Already-posted
// depreciation journals are NOT rewritten; repost via run-depreciation only
// after reversing, which is a manual ledger operation by design.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try { body = ((await req.json()) ?? {}) as Record<string, unknown>; } catch { /* validated below */ }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.description = (body.name as string).trim();
  if (body.usefulLifeMonths != null) {
    const v = Number(body.usefulLifeMonths);
    if (!Number.isInteger(v) || v <= 0) return NextResponse.json({ error: "usefulLifeMonths must be a positive integer" }, { status: 400 });
    patch.useful_life_months = v;
  }
  if (body.residual != null) {
    const v = Number(body.residual);
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "residual must be >= 0" }, { status: 400 });
    patch.residual = v;
  }
  if (typeof body.accountCode === "string") {
    if (!/^1500-\d{2}$/.test(body.accountCode)) {
      return NextResponse.json({ error: "accountCode must be a 1500-xx PP&E account" }, { status: 400 });
    }
    patch.account_code = body.accountCode;
  }
  if (body.outletId === null || typeof body.outletId === "string") patch.outlet_id = (body.outletId as string | null) || null;
  if (body.notes === null || typeof body.notes === "string") patch.notes = (body.notes as string | null) || null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const client = getFinanceClient();
  // residual cannot exceed cost, check against the stored cost.
  if (patch.residual != null) {
    const { data: row } = await client.from("fin_fixed_assets").select("cost").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    if (Number(patch.residual) >= Number(row.cost)) {
      return NextResponse.json({ error: "residual must be below cost" }, { status: 400 });
    }
  }
  await client.rpc("fin_set_actor", { p_actor: auth.user.id }).then(() => undefined, () => undefined);
  const { error } = await client.from("fin_fixed_assets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
