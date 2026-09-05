// POST /api/finance/bank-lines/match-split — a human confirms a split-payment
// proposal from the recon page: several bank lines (deposit + balance,
// instalments) settle ONE invoice. Body { invoiceId, bankLineIds }.
//
// Recomputed server-side from the ids, never trusted from the client: the legs
// must be unmatched DR lines, and the invoice's payment state moves by their
// total (PAID when cleared, DEPOSIT_PAID / PARTIALLY_PAID otherwise, link-only
// when the invoice was already PAID via another route).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeSplitMatch, digitRuns, invoiceRefInDesc, type ApSplitMatch } from "@/lib/finance/ap-match";
import { logBankLineEvents } from "@/lib/finance/bank-line-events";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function guard(req: NextRequest): Promise<{ error: NextResponse | null; user: SessionUser | null }> {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error, user: null };
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null };
  }
  return { error: null, user: auth.user };
}

export async function POST(req: NextRequest) {
  const { error: err, user } = await guard(req);
  if (err) return err;
  let body: { invoiceId?: string; bankLineIds?: string[] } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const invoiceId = body.invoiceId;
  const bankLineIds = Array.isArray(body.bankLineIds) ? [...new Set(body.bankLineIds.filter((x) => typeof x === "string"))] : [];
  if (!invoiceId || bankLineIds.length === 0) {
    return NextResponse.json({ error: "invoiceId and bankLineIds[] required" }, { status: 400 });
  }
  if (bankLineIds.length > 8) return NextResponse.json({ error: "at most 8 legs" }, { status: 400 });

  const [inv, lines, linkedAgg] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, invoiceNumber: true, amount: true, amountPaid: true, status: true, issueDate: true, vendorName: true, supplier: { select: { name: true } } },
    }),
    prisma.bankStatementLine.findMany({
      where: { id: { in: bankLineIds } },
      select: { id: true, description: true, amount: true, txnDate: true, direction: true, apInvoiceId: true, glTransactionId: true },
    }),
    prisma.bankStatementLine.aggregate({ where: { apInvoiceId: invoiceId }, _sum: { amount: true } }),
  ]);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (inv.status === "DRAFT") return NextResponse.json({ error: "Invoice is a DRAFT — verify it before recording payment" }, { status: 409 });
  if (lines.length !== bankLineIds.length) return NextResponse.json({ error: "One or more bank lines not found" }, { status: 404 });
  const taken = lines.find((l) => l.apInvoiceId);
  if (taken) return NextResponse.json({ error: `Bank line ${taken.id} is already matched` }, { status: 409 });
  if (lines.some((l) => l.direction !== "DR")) return NextResponse.json({ error: "Only outflow (DR) lines can settle an invoice" }, { status: 400 });

  const amount = round2(Number(inv.amount));
  const linkOnly = inv.status === "PAID";
  const previouslyPaid = linkOnly ? 0 : round2(Math.max(Number(linkedAgg._sum.amount ?? 0), Number(inv.amountPaid ?? 0)));
  const legsTotal = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
  if (legsTotal > amount - previouslyPaid + 0.01) {
    return NextResponse.json({
      error: `Legs total RM ${legsTotal.toFixed(2)} exceeds the outstanding RM ${(amount - previouslyPaid).toFixed(2)} — that would be an overpayment`,
    }, { status: 409 });
  }
  const payee = inv.supplier?.name ?? inv.vendorName ?? "(unknown payee)";
  const m: ApSplitMatch = {
    invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, payee, amount, previouslyPaid, legsTotal,
    settles: previouslyPaid + legsTotal >= amount - 0.01, issueDate: ymd(inv.issueDate),
    legs: lines.map((l) => ({
      bankLineId: l.id, bankDesc: (l.description ?? "").slice(0, 60), bankDate: ymd(l.txnDate), amount: round2(Number(l.amount)),
      refConfirmed: invoiceRefInDesc(inv.invoiceNumber, digitRuns((l.description ?? "").toLowerCase())), named: true,
    })),
    tier: "auto", reasons: ["manual split match"], linkOnly,
  };
  await writeSplitMatch(m);

  // Re-tagged legs that were already posted need their day-journals re-keyed.
  const glIds = [...new Set(lines.map((l) => l.glTransactionId).filter((x): x is string => !!x))];
  if (glIds.length) {
    await prisma.bankStatementLine.updateMany({ where: { glTransactionId: { in: glIds } }, data: { glTransactionId: null, glPostedAt: null } });
  }
  await logBankLineEvents(
    lines.map((l) => ({
      lineId: l.id, event: "match" as const, oldValue: null,
      newValue: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, payee, linkOnly, split: true, legs: lines.length, settles: m.settles },
    })),
    user?.name,
  );
  return NextResponse.json({ ok: true, linkOnly, settles: m.settles, legsTotal });
}
