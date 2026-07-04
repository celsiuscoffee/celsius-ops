// Depreciation run for one month, across all companies with assets.
//
// GET  ?yearMonth=YYYY-MM         is a dry-run preview: per-company totals
//                                   and per-asset amounts, nothing posted.
// POST { yearMonth, preview? }      posts ONE journal per company via the
//                                   ledger engine (Dr 6512, Cr 1550-xx),
//                                   unless preview=true (same as GET).
//
// Idempotent: each company-month has a deterministic posting_key, so
// re-running a month never double posts (the run reports alreadyPosted
// instead). Owner/Admin only.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { runDepreciation } from "@/lib/finance/fixed-assets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function guard(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const yearMonth = new URL(req.url).searchParams.get("yearMonth") ?? "";
  try {
    const result = await runDepreciation({ yearMonth, commit: false });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  let body: { yearMonth?: string; preview?: boolean } = {};
  try { body = (await req.json()) ?? {}; } catch { /* validated below */ }
  try {
    if (!body.preview) {
      const client = getFinanceClient();
      await client.rpc("fin_set_actor", { p_actor: g.user.id }).then(() => undefined, () => undefined);
    }
    const result = await runDepreciation({ yearMonth: body.yearMonth ?? "", commit: !body.preview });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
