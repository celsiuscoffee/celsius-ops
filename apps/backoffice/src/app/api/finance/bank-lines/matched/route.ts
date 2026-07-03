// GET /api/finance/bank-lines/matched — the applied AP matches, newest first,
// so a wrong auto-match can be found and undone. ?q= searches the bank
// description and the invoice payee/number.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);

  // apInvoiceId is a plain column (no Prisma relation) — fetch the invoices
  // separately and join in memory. The matched pile is a few thousand rows at
  // most, and q must search invoice fields too.
  const lines = await prisma.bankStatementLine.findMany({
    where: { apInvoiceId: { not: null } },
    orderBy: { apMatchedAt: "desc" },
    take: 3000,
    select: {
      id: true, txnDate: true, description: true, amount: true, category: true,
      apMatchedAt: true, apInvoiceId: true,
    },
  });
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.apInvoiceId as string))] } },
    select: {
      id: true, invoiceNumber: true, amount: true, status: true, paidVia: true,
      vendorName: true, supplier: { select: { name: true } },
    },
  });
  const invById = new Map(invoices.map((i) => [i.id, i]));

  const rows = lines
    .map((l) => {
      const inv = invById.get(l.apInvoiceId as string);
      const payee = inv?.supplier?.name ?? inv?.vendorName ?? "(unknown payee)";
      return {
        bankLineId: l.id,
        date: ymd(l.txnDate),
        desc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 70),
        amount: round2(Number(l.amount)),
        category: l.category as string | null,
        matchedAt: l.apMatchedAt ? ymd(l.apMatchedAt) : null,
        invoiceId: l.apInvoiceId,
        invoiceNumber: inv?.invoiceNumber ?? null,
        payee,
        invoiceAmount: inv ? round2(Number(inv.amount)) : null,
        // paid by this match vs already settled elsewhere (link-only)
        paidByMatch: inv?.paidVia === "bank-ap-match" || inv?.paidVia === `bank-ap-match-multi:${l.id}`,
      };
    })
    .filter((r) => !q ||
      r.desc.toLowerCase().includes(q) ||
      r.payee.toLowerCase().includes(q) ||
      (r.invoiceNumber ?? "").toLowerCase().includes(q) ||
      r.date.includes(q) ||
      String(r.amount).includes(q))
    .slice(0, limit);

  return NextResponse.json({ total: lines.length, rows });
}
