import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { detectPaymentFlags, mergeFlags } from "@/lib/inventory/flag-detector";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(invoice);
  } catch (err) {
    console.error("[invoices/[id] GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json();
    const { status, invoiceNumber, issueDate, dueDate, notes, amount, photos, paidVia, paymentRef, depositRef, deliveryDate } = body;
    const depositPercentInput: number | null | undefined = body.depositPercent;
    const depositTermsInput: number | null | undefined = body.depositTermsDays;
    // Partial-payment recording — caller passes paymentAmount to apply a
    // partial payment. We increment amountPaid and let the status auto-flip
    // below. Independent of (and pairs with) the existing status-based flow.
    const paymentAmountInput: number | null | undefined = body.paymentAmount;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (invoiceNumber !== undefined) data.invoiceNumber = invoiceNumber;
    if (issueDate !== undefined) data.issueDate = issueDate ? new Date(issueDate) : new Date();
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (deliveryDate !== undefined) data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null;
    if (notes !== undefined) data.notes = notes;
    if (amount !== undefined) data.amount = amount;
    if (photos !== undefined) data.photos = photos;
    if (paidVia !== undefined) data.paidVia = paidVia;
    if (paymentRef !== undefined) data.paymentRef = paymentRef;
    if (status === "PAID") data.paidAt = new Date();

    // Deposit overrides — caller can set/clear deposit on this invoice.
    // We always recompute depositAmount when percent or amount changes so
    // they can never drift apart silently.
    const willChangeDepositPolicy =
      depositPercentInput !== undefined || amount !== undefined;
    if (depositPercentInput === null) {
      data.depositPercent = null;
      data.depositAmount = null; // explicit "no deposit" → wipe the amount too
    } else if (typeof depositPercentInput === "number") {
      data.depositPercent = depositPercentInput > 0 ? depositPercentInput : null;
    }
    if (depositTermsInput === null) {
      data.depositTermsDays = null;
    } else if (typeof depositTermsInput === "number") {
      data.depositTermsDays = depositTermsInput > 0 ? depositTermsInput : null;
    }
    if (willChangeDepositPolicy && depositPercentInput !== null) {
      // Recompute depositAmount from the (possibly new) percent + amount.
      // Read current row when one side wasn't supplied.
      const current = await prisma.invoice.findUnique({
        where: { id },
        select: { amount: true, depositPercent: true },
      });
      const effPct = typeof depositPercentInput === "number"
        ? depositPercentInput
        : (current?.depositPercent ?? 0);
      const effAmt = amount !== undefined ? Number(amount) : Number(current?.amount ?? 0);
      if (effPct > 0 && effAmt > 0) {
        data.depositAmount = Math.round((effAmt * effPct / 100) * 100) / 100;
      }
    }

    // Deposit payment handling — also compute balance due date from the
    // depositTermsDays on this invoice (or, for legacy rows, the supplier).
    if (status === "DEPOSIT_PAID") {
      const now = new Date();
      data.depositPaidAt = now;
      if (depositRef) data.depositRef = depositRef;

      // Only overwrite dueDate if caller didn't pass one explicitly
      if (dueDate === undefined) {
        const inv = await prisma.invoice.findUnique({
          where: { id },
          select: { depositTermsDays: true, supplier: { select: { depositTermsDays: true } } },
        });
        const termsDays = inv?.depositTermsDays ?? inv?.supplier?.depositTermsDays;
        if (termsDays && termsDays > 0) {
          const balanceDue = new Date(now);
          balanceDue.setDate(balanceDue.getDate() + termsDays);
          data.dueDate = balanceDue;
        }
      }
    }

    // Status / amountPaid sync. Two ways to land here:
    //   1) caller passes paymentAmount → increment amountPaid, derive status
    //   2) caller flips status (PAID, DEPOSIT_PAID) → mirror amountPaid
    // This keeps a single source of truth (amountPaid) so cashflow + UI
    // never disagree, while preserving the legacy "Mark Paid" buttons.
    if (typeof paymentAmountInput === "number" && paymentAmountInput > 0) {
      const current = await prisma.invoice.findUnique({
        where: { id },
        select: { amount: true, amountPaid: true, depositAmount: true, status: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const total = Number(current.amount);
      const alreadyPaid = Number(current.amountPaid ?? 0);
      const newPaid = Math.min(alreadyPaid + paymentAmountInput, total);
      data.amountPaid = newPaid;

      // Status reflects how much is paid + whether it lines up with deposit.
      const dep = current.depositAmount ? Number(current.depositAmount) : 0;
      if (newPaid >= total) {
        data.status = "PAID";
        data.paidAt = new Date();
      } else if (dep > 0 && Math.abs(newPaid - dep) < 0.01) {
        // Exactly hit the deposit amount — keep the existing DEPOSIT_PAID
        // label so the deposit-vs-balance UI flows continue to work.
        data.status = "DEPOSIT_PAID";
        data.depositPaidAt = new Date();
        if (paymentRef) data.depositRef = paymentRef;
      } else {
        data.status = "PARTIALLY_PAID";
      }
    } else if (status === "PAID") {
      // Mirror amountPaid to amount when status flips to PAID without an
      // explicit paymentAmount (legacy "Mark Paid" buttons).
      const current = await prisma.invoice.findUnique({ where: { id }, select: { amount: true } });
      if (current) data.amountPaid = current.amount;
    } else if (status === "DEPOSIT_PAID") {
      // Mirror amountPaid to depositAmount when the legacy "Pay Deposit"
      // button is used.
      const current = await prisma.invoice.findUnique({
        where: { id },
        select: { depositAmount: true, amountPaid: true },
      });
      if (current?.depositAmount) {
        const dep = Number(current.depositAmount);
        const already = Number(current.amountPaid ?? 0);
        if (dep > already) data.amountPaid = dep;
      }
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data,
    });

    // When transitioning to PAID/DEPOSIT_PAID, run the flag detector against
    // the freshly-attached payment data so the UI can surface any duplicates.
    if (status === "PAID" || status === "DEPOSIT_PAID") {
      const paymentRefForCheck = status === "DEPOSIT_PAID" ? depositRef : paymentRef;
      const newFlags = await detectPaymentFlags({
        invoiceId: id,
        paymentRef: paymentRefForCheck ?? null,
      });
      if (newFlags.length > 0) {
        const merged = mergeFlags(invoice.flags, newFlags);
        await prisma.invoice.update({
          where: { id },
          data: { flags: merged as unknown as Prisma.InputJsonValue },
        });
      }
    }

    return NextResponse.json(invoice);
  } catch (err) {
    console.error("[invoices/[id] PATCH]", err);
    const message = err instanceof Error ? err.message : "Failed to update invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!["DRAFT", "PENDING"].includes(invoice.status)) {
      return NextResponse.json({ error: "Only draft or pending invoices can be deleted" }, { status: 400 });
    }

    await prisma.invoice.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[invoices/[id] DELETE]", err);
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
