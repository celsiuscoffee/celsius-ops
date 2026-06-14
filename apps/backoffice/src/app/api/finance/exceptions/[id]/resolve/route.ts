// POST /api/finance/exceptions/:id/resolve
// Body: { action: "approve" }
//     | { action: "correct", accountCode, outletId? }                         // categorization
//     | { action: "match", candidateId, candidateType: invoice|bill|transaction, amountMatched? } // reconciliation
//     | { action: "dismiss", reason }
//
// Posts the bill journal (approve/correct on a categorization exception),
// commits a reconciliation (approve/match on a match exception), or dismisses.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { resolveException, type InboxAction } from "@/lib/finance/inbox";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const action = body.action;
  let parsed: InboxAction;
  if (action === "approve") {
    parsed = { kind: "approve" };
  } else if (action === "correct") {
    if (typeof body.accountCode !== "string" || !body.accountCode) {
      return NextResponse.json({ error: "accountCode required for correct" }, { status: 400 });
    }
    parsed = {
      kind: "correct",
      accountCode: body.accountCode,
      outletId: typeof body.outletId === "string" ? body.outletId : null,
    };
  } else if (action === "match") {
    const candidateType = body.candidateType;
    if (typeof body.candidateId !== "string" || !body.candidateId) {
      return NextResponse.json({ error: "candidateId required for match" }, { status: 400 });
    }
    if (candidateType !== "invoice" && candidateType !== "bill" && candidateType !== "transaction") {
      return NextResponse.json({ error: "candidateType must be invoice|bill|transaction" }, { status: 400 });
    }
    parsed = {
      kind: "match",
      candidateId: body.candidateId,
      candidateType,
      amountMatched: typeof body.amountMatched === "number" ? body.amountMatched : undefined,
    };
  } else if (action === "dismiss") {
    parsed = { kind: "dismiss", reason: typeof body.reason === "string" ? body.reason : "no reason" };
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    const result = await resolveException(id, auth.user.id, parsed);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
