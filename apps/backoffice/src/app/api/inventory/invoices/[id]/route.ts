import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { detectPaymentFlags, mergeFlags } from "@/lib/inventory/flag-detector";
import { sendProofOfPayment } from "@/lib/inventory/procurement-whatsapp";

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

    // ── Payment guards (money-safety) ──────────────────────────────────────
    // The PATCH route is the real boundary — the UI only hides buttons, so a direct
    // call / stale client / double-submit could otherwise pay the wrong thing. Two rules:
    //   1. Never re-stamp an already-PAID invoice (double-pay / paidAt reset).
    //   2. Never record a payment on a DRAFT or unconfirmed AI-captured invoice — those
    //      carry a PROVISIONAL amount (the PO total), not the supplier's real bill, so they
    //      must be verified (confirm prefill or edit the amount) before any payment lands.
    const PAYMENT_STATUSES = ["INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "PAID"];
    if (typeof status === "string" && PAYMENT_STATUSES.includes(status)) {
      const current = await prisma.invoice.findUnique({
        where: { id },
        select: { status: true, aiPrefilledAt: true },
      });
      if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      if (current.status === "PAID") {
        return NextResponse.json({ error: "Invoice is already paid." }, { status: 409 });
      }
      const verifyingNow = body.confirmAiPrefill === true || body.amount !== undefined;
      if ((current.status === "DRAFT" || current.aiPrefilledAt != null) && !verifyingNow) {
        return NextResponse.json(
          { error: "Verify the captured invoice amount before recording a payment." },
          { status: 409 },
        );
      }
    }

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
    // Append a single flag (e.g. BILLED_VS_RECEIVED reconciliation flag
    // surfaced by the Attach Supplier Invoice dialog). Idempotent against
    // re-saves of the same code.
    if (body.addFlag && typeof body.addFlag === "object" && body.addFlag.code) {
      const existing = await prisma.invoice.findUnique({ where: { id }, select: { flags: true } });
      const currentFlags = Array.isArray(existing?.flags) ? (existing!.flags as Array<{ code?: string }>) : [];
      const dedup = currentFlags.filter((f) => f?.code !== body.addFlag.code);
      data.flags = [...dedup, body.addFlag];
    }
    // Confirm/clear the AI prefill marker. Pass `confirmAiPrefill: true` to
    // explicitly accept the AI's suggestions and drop the "verify" banner.
    // Manual edits to invoiceNumber/dueDate/issueDate/amount also clear it
    // implicitly — if procurement edited a field, they've effectively
    // reviewed it.
    if (body.confirmAiPrefill === true) {
      data.aiPrefilledAt = null;
      data.aiPrefilledFields = null;
    } else if (
      body.invoiceNumber !== undefined ||
      body.dueDate !== undefined ||
      body.issueDate !== undefined ||
      body.amount !== undefined
    ) {
      data.aiPrefilledAt = null;
      data.aiPrefilledFields = null;
    }

    // Amount edited on an already-PAID invoice (e.g. the supplier's real total
    // came in higher than what we settled) without an explicit status or
    // payment in this request → the invoice is no longer fully paid. Flip it
    // back to PARTIALLY_PAID so the stranded balance is visible, instead of
    // leaving it PAID with money still owed. Scoped to PAID only — deposit
    // flows manage their own balance leg.
    if (
      amount !== undefined &&
      status === undefined &&
      !(typeof paymentAmountInput === "number" && paymentAmountInput > 0)
    ) {
      const current = await prisma.invoice.findUnique({
        where: { id },
        select: { status: true, amountPaid: true },
      });
      if (current?.status === "PAID") {
        const paid = Number(current.amountPaid ?? 0);
        if (Number(amount) - paid > 0.01) {
          data.status = paid > 0 ? "PARTIALLY_PAID" : "PENDING";
          data.paidAt = null;
        }
      }
    }

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

    // Deposit payment handling. The invoice's dueDate is the BALANCE due
    // date as set on the supplier invoice — we don't recompute it. Deposit
    // is implicitly due on issueDate ("immediately"), so there's nothing to
    // recompute here once the deposit is recorded.
    if (status === "DEPOSIT_PAID") {
      data.depositPaidAt = new Date();
      if (depositRef) data.depositRef = depositRef;
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
        // Defensive: caller may have passed status:"PAID" alongside
        // paymentAmount. We're overriding status here, so clear any paidAt
        // that the unconditional `if (status === "PAID")` branch above set.
        data.paidAt = null;
      } else {
        data.status = "PARTIALLY_PAID";
        data.paidAt = null; // same defensive override
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

    // Make the full-PAID transition ATOMIC. The early guard above is a read-then-write
    // (TOCTOU): two concurrent mark-paid requests (double-click / stale client / a second
    // tab, or a paymentAmount that completes the invoice with no status param) could both
    // pass it and both write PAID — resetting paidAt and firing the POP auto-send twice.
    // Gate the write on the row still NOT being PAID so exactly one wins; the loser gets the
    // same 409. Non-payment edits keep the plain update. (Mirrors the Telegram path's guard.)
    let invoice: Awaited<ReturnType<typeof prisma.invoice.update>>;
    if (data.status === "PAID") {
      const res = await prisma.invoice.updateMany({
        where: { id, status: { not: "PAID" } },
        data,
      });
      if (res.count === 0) {
        return NextResponse.json({ error: "Invoice is already paid." }, { status: 409 });
      }
      invoice = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    } else {
      invoice = await prisma.invoice.update({ where: { id }, data });
    }

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

    // Auto-send Proof of Payment to the supplier once the invoice is fully
    // PAID (gated by PROCUREMENT_WHATSAPP_ENABLED; idempotent via popSentAt).
    // Best-effort — a WhatsApp failure must never fail the payment write.
    if (invoice.status === "PAID" && !invoice.popSentAt) {
      try {
        const pop = await sendProofOfPayment(id);
        if (pop.sent) {
          console.log(`[invoices/[id]] POP auto-sent invoice=${id} msg=${pop.messageId}`);
        } else if (pop.reason && pop.reason !== "disabled") {
          console.log(`[invoices/[id]] POP not sent invoice=${id} reason=${pop.reason}`);
        }
      } catch (e) {
        console.warn(`[invoices/[id]] POP auto-send error invoice=${id}:`, e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(invoice);
  } catch (err) {
    console.error("[invoices/[id] PATCH]", err);
    // Surface unique-constraint violations as a human message instead of
    // the raw Postgres error. P2002 is Prisma's "unique constraint failed".
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: string[] } }).meta?.target;
      if (target?.includes("invoiceNumber")) {
        return NextResponse.json(
          { error: "That invoice number is already in use for this supplier. Use a different number or attach the existing invoice." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Duplicate value — that combination already exists." }, { status: 409 });
    }
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
