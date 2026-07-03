// GET /api/finance/reclassify — dry-run: what the CURRENT rules would change
// in the OTHER_OUTFLOW/unclassified pile. POST commits (updates categories and
// un-stamps affected GL journals; the next gl-post run re-keys them).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { reclassifyBankLines } from "@/lib/finance/reclassify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  try {
    const full = new URL(req.url).searchParams.get("full") === "true";
    return NextResponse.json(await reclassifyBankLines({ commit: false, full }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  try {
    let body: { full?: boolean } = {};
    try { body = await req.json(); } catch { /* optional body */ }
    return NextResponse.json(await reclassifyBankLines({ commit: true, full: body.full ?? false }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
