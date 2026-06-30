// GET /api/finance/gl-post — dry-run preview of the bank→GL posting bridge.
// Returns the journals it WOULD post and a per-category coverage breakdown
// (incl. how much parks in suspense) without writing anything. POST commits.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { postBankLinesToGl } from "@/lib/finance/gl-posting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
