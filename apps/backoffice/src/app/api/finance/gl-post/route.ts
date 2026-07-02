// GET /api/finance/gl-post — dry-run preview of the bank→GL posting bridge.
// Returns the journals it WOULD post and a per-category coverage breakdown
// (incl. how much parks in suspense) without writing anything. POST commits.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { postBankLinesToGl } from "@/lib/finance/gl-posting";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const preview = await postBankLinesToGl({ commit: false });
    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Manual commit — the header comment always promised this but only the cron
// had it. Body: { limit?: number } to bound a run; call repeatedly to drain.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let limit: number | undefined;
  try {
    const body = (await req.json()) as { limit?: number };
    if (typeof body?.limit === "number" && body.limit > 0) limit = Math.floor(body.limit);
  } catch { /* empty body — no limit */ }
  try {
    const result = await postBankLinesToGl({ commit: true, limit });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
