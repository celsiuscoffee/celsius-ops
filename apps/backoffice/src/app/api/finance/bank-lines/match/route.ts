// Manual invoice matching for a bank line.
//
// GET  ?bankLineId=…       → ranked candidate invoices (amount proximity,
//                            payee/invoice-no hits, open before paid-unlinked)
// POST { bankLineId, invoiceId } → apply: link the line (and mark the invoice
//                            paid unless it was already settled via another
//                            route — then it's link-only, invoice untouched).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeApMatch, digitRuns, invoiceRefInDesc, type ApMatch } from "@/lib/finance/ap-match";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
  const bankLineId = new URL(req.url).searchParams.get("bankLineId");
  if (!bankLineId) return NextResponse.json({ error: "bankLineId required" }, { status: 400 });

  const line = await prisma.bankStatementLine.findUnique({
    where: { id: bankLineId },
    select: { id: true, description: true, amount: true, txnDate: true, apInvoiceId: true },
  });
  if (!line) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
  if (line.apInvoiceId) return NextResponse.json({ error: "Already matched" }, { status: 409 });

  const amt = Number(line.amount);
  const descLower = (line.description ?? "").toLowerCase();
  const runs = digitRuns(descLower);
  const windowStart = new Date(line.txnDate.getTime() - 120 * 86400_000);

  const [invoices, linkedRows] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        issueDate: { gte: windowStart, lte: new Date(line.txnDate.getTime() + 14 * 86400_000) },
        amount: { gte: amt * 0.5, lte: amt * 1.5 },
      },
      select: {
        id: true, invoiceNumber: true, amount: true, status: true, issueDate: true,
        vendorName: true, supplier: { select: { name: true } },
      },
      take: 400,
    }),
    prisma.bankStatementLine.findMany({ where: { apInvoiceId: { not: null } }, select: { apInvoiceId: true } }),
  ]);
  const linked = new Set(linkedRows.map((r) => r.apInvoiceId as string));

  const candidates = invoices
    .filter((i) => !(i.status === "PAID" && linked.has(i.id))) // settled AND linked = done
    .map((i) => {
      const payee = i.supplier?.name ?? i.vendorName ?? "(unknown payee)";
      const diff = Math.abs(Number(i.amount) - amt);
      const nameHit = payee.length >= 4 && descLower.includes(payee.toLowerCase().split(" ")[0]);
      const refHit = invoiceRefInDesc(i.invoiceNumber, runs);
      const score = (diff <= 0.01 ? 3 : diff <= amt * 0.005 ? 2 : 0) + (refHit ? 3 : 0) + (nameHit ? 1 : 0);
      return {
        invoiceId: i.id, invoiceNumber: i.invoiceNumber, payee,
        amount: round2(Number(i.amount)), issueDate: ymd(i.issueDate),
        status: i.status, linkOnly: i.status === "PAID",
        amountExact: diff <= 0.01, refHit, nameHit, score,
      };
    })
    .sort((a, b) => b.score - a.score || Math.abs(a.amount - amt) - Math.abs(b.amount - amt))
    .slice(0, 12);

  return NextResponse.json({ line: { id: line.id, amount: round2(amt), date: ymd(line.txnDate) }, candidates });
}

export async function POST(req: NextRequest) {
  const err = await guard(req);
  if (err) return err;
  let body: { bankLineId?: string; invoiceId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const { bankLineId, invoiceId } = body;
  if (!bankLineId || !invoiceId) return NextResponse.json({ error: "bankLineId and invoiceId required" }, { status: 400 });

  const [line, inv, alreadyLinked] = await Promise.all([
    prisma.bankStatementLine.findUnique({ where: { id: bankLineId }, select: { id: true, description: true, amount: true, txnDate: true, apInvoiceId: true, glTransactionId: true, category: true } }),
    prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, amount: true, status: true, issueDate: true, outletId: true, vendorName: true, supplier: { select: { name: true } } } }),
    prisma.bankStatementLine.findFirst({ where: { apInvoiceId: invoiceId }, select: { id: true } }),
  ]);
  if (!line) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (line.apInvoiceId) return NextResponse.json({ error: "Line already matched" }, { status: 409 });
  if (inv.status === "PAID" && alreadyLinked) {
    return NextResponse.json({ error: "Invoice already settled by another bank line — matching again would be a double payment" }, { status: 409 });
  }

  const linkOnly = inv.status === "PAID";
  const m: ApMatch = {
    invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
    payee: inv.supplier?.name ?? inv.vendorName ?? "(unknown payee)",
    amount: round2(Number(inv.amount)), issueDate: ymd(inv.issueDate), outletId: inv.outletId,
    bankLineId: line.id, bankDesc: (line.description ?? "").slice(0, 60), bankDate: ymd(line.txnDate),
    bankCategory: line.category as string | null,
    score: 1, tier: "auto", reasons: ["manual match"], alreadyPaid: false, linkOnly,
  };
  await writeApMatch(m);
  // The match re-tags the line's category; if it was posted under the old one,
  // re-key the whole day-aggregate journal.
  if (line.glTransactionId) {
    await prisma.bankStatementLine.updateMany({
      where: { glTransactionId: line.glTransactionId },
      data: { glTransactionId: null, glPostedAt: null },
    });
  }
  return NextResponse.json({ ok: true, linkOnly });
}
