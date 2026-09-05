import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { dueDateIsBelievable } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { detectPaymentFlags, mergeFlags, type InvoiceFlag } from "@/lib/inventory/flag-detector";
import { sendProofOfPayment } from "@/lib/inventory/procurement-whatsapp";
import {
  amountMismatchesOrder,
  isOverpayment,
  isPayerRole,
  moneyHasMoved,
  receiptRequirementMode,
} from "@/lib/inventory/payment-guards";

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
    const isPaymentInput = typeof paymentAmountInput === "number" && paymentAmountInput > 0;

    // One read of the row, shared by every guard below. `order` carries what
    // the payment guards need: what kind of order it is, its total, and whether
    // any goods have been received against it.
    const current = await prisma.invoice.findUnique({
      where: { id },
      select: {
        status: true,
        amount: true,
        amountPaid: true,
        depositAmount: true,
        depositPercent: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        aiPrefilledAt: true,
        flags: true,
        order: {
          select: {
            orderType: true,
            totalAmount: true,
            _count: { select: { receivings: true } },
          },
        },
      },
    });
    if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    // Flags this request itself raises (in addition to body.addFlag and the
    // post-write payment detector). Merged into the same write as the change.
    const extraFlags: InvoiceFlag[] = [];
    // Non-blocking cautions, returned alongside the invoice as `warnings`.
    const warnings: string[] = [];
    const nowIso = new Date().toISOString();

    // ── Money-safety guards ────────────────────────────────────────────────
    // The PATCH route is the real boundary — the UI only hides buttons, so a direct
    // call / stale client / double-submit could otherwise pay the wrong thing.

    // 1. An amount edit and a status change (or a payment) never travel in the same
    //    request. Changing what is owed and settling it must be two deliberate acts,
    //    otherwise "edit the amount to whatever I'm paying and mark it paid" is one
    //    click — which is how a provisional PO total got paid as if it were the bill.
    if (amount !== undefined && (status !== undefined || isPaymentInput)) {
      return NextResponse.json(
        {
          error: "Change the invoice amount first, then record the payment as a separate step.",
          code: "AMOUNT_WITH_STATUS_CHANGE",
        },
        { status: 400 },
      );
    }

    // 2. Once money has moved (PAID / PARTIALLY_PAID / DEPOSIT_PAID) the invoice's
    //    identity and amount are locked. Only OWNER/ADMIN may still change them, and
    //    only with a written reason, which is recorded on the row as a flag.
    const amountChanges =
      amount !== undefined && Math.abs(Number(amount) - Number(current.amount)) > 0.001;
    const numberChanges =
      invoiceNumber !== undefined && String(invoiceNumber).trim() !== current.invoiceNumber;
    if ((amountChanges || numberChanges) && moneyHasMoved(current.status)) {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const privileged = caller.role === "OWNER" || caller.role === "ADMIN";
      if (!privileged || !reason) {
        return NextResponse.json(
          {
            error: `This invoice is ${current.status} — its number and amount are locked. An owner/admin can change them with a reason.`,
            code: "LOCKED_AFTER_PAYMENT",
          },
          { status: privileged ? 400 : 403 },
        );
      }
      const fields: string[] = [];
      if (numberChanges) fields.push(`invoiceNumber ${current.invoiceNumber} → ${String(invoiceNumber).trim()}`);
      if (amountChanges) fields.push(`amount RM ${Number(current.amount).toFixed(2)} → RM ${Number(amount).toFixed(2)}`);
      extraFlags.push({
        code: "EDITED_AFTER_PAYMENT",
        message: `${fields.join("; ")} — edited while ${current.status} by ${caller.name}: ${reason}`,
        detectedAt: nowIso,
        meta: { editedById: caller.id, reason, fields, statusAtEdit: current.status },
      });
    }

    // 3. Never re-stamp an already-PAID invoice (double-pay / paidAt reset), and
    //    never record a payment on a DRAFT or unconfirmed AI-captured invoice —
    //    those carry a PROVISIONAL amount (the PO total), not the supplier's real
    //    bill. Verification is an explicit act (confirmAiPrefill: true) — editing
    //    the amount in passing no longer counts, and cannot ride along anyway (1).
    const PAYMENT_STATUSES = ["INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "PAID"];
    if ((typeof status === "string" && PAYMENT_STATUSES.includes(status)) || isPaymentInput) {
      if (current.status === "PAID") {
        return NextResponse.json({ error: "Invoice is already paid." }, { status: 409 });
      }
      const verifyingNow = body.confirmAiPrefill === true;
      if ((current.status === "DRAFT" || current.aiPrefilledAt != null) && !verifyingNow) {
        return NextResponse.json(
          {
            error: "Verify the captured invoice amount before recording a payment.",
            code: "UNVERIFIED_CAPTURE",
          },
          { status: 409 },
        );
      }
    }

    // Reject an impossible date pair before anything is written. Either date
    // can be edited on its own, so correcting an issue date forward can strand
    // an older due date behind it — a balance falling due before the invoice
    // exists. Checked against whichever side the caller isn't changing.
    if (issueDate !== undefined || dueDate !== undefined) {
      const nextIssue =
        issueDate !== undefined ? (issueDate ? new Date(issueDate) : new Date()) : current.issueDate;
      const nextDue =
        dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : current.dueDate;
      if (!dueDateIsBelievable(nextIssue, nextDue)) {
        return NextResponse.json(
          {
            error: `Balance due date (${nextDue?.toISOString().slice(0, 10)}) is before the issue date (${nextIssue
              ?.toISOString()
              .slice(0, 10)}). An invoice cannot fall due before it is issued.`,
            code: "DUE_BEFORE_ISSUE",
          },
          { status: 400 },
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
    let flagsForWrite: unknown = undefined;
    if (body.addFlag && typeof body.addFlag === "object" && body.addFlag.code) {
      const currentFlags = Array.isArray(current.flags) ? (current.flags as Array<{ code?: string }>) : [];
      const dedup = currentFlags.filter((f) => f?.code !== body.addFlag.code);
      flagsForWrite = [...dedup, body.addFlag];
    }
    // Confirm/clear the AI prefill marker. Pass `confirmAiPrefill: true` to
    // explicitly accept the AI's suggestions and drop the "verify" banner.
    // Manual edits to invoiceNumber/dueDate/issueDate/amount also clear it
    // implicitly — if procurement edited a field, they've effectively
    // reviewed it. (That implicit clear no longer unlocks a payment in the
    // same request — see guard 1.)
    let confirmingCapture = false;
    if (body.confirmAiPrefill === true) {
      data.aiPrefilledAt = null;
      data.aiPrefilledFields = null;
      confirmingCapture = true;
    } else if (
      body.invoiceNumber !== undefined ||
      body.dueDate !== undefined ||
      body.issueDate !== undefined ||
      body.amount !== undefined
    ) {
      data.aiPrefilledAt = null;
      data.aiPrefilledFields = null;
      confirmingCapture = true;
    }
    // Promote a reviewed capture to a real payable. An AI-captured invoice lands
    // as DRAFT and is NEVER payable (getActions has no DRAFT action, and the
    // payment guard blocks DRAFT), so confirming/editing it must move it to
    // PENDING — otherwise it's stranded in DRAFT forever with no way out. Only
    // from DRAFT, and only when the caller didn't set an explicit status itself.
    if (confirmingCapture && status === undefined && current.status === "DRAFT") {
      data.status = "PENDING";
    }

    // Amount edited on an already-PAID invoice (owner/admin with a reason —
    // guard 2) without a payment in this request → the invoice is no longer
    // fully paid. Flip it back to PARTIALLY_PAID so the stranded balance is
    // visible, instead of leaving it PAID with money still owed. Scoped to
    // PAID only — deposit flows manage their own balance leg.
    if (amount !== undefined && status === undefined && !isPaymentInput && current.status === "PAID") {
      const paid = Number(current.amountPaid ?? 0);
      if (Number(amount) - paid > 0.01) {
        data.status = paid > 0 ? "PARTIALLY_PAID" : "PENDING";
        data.paidAt = null;
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
      const effPct = typeof depositPercentInput === "number"
        ? depositPercentInput
        : (current.depositPercent ?? 0);
      const effAmt = amount !== undefined ? Number(amount) : Number(current.amount ?? 0);
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
    if (isPaymentInput) {
      const total = Number(current.amount);
      const alreadyPaid = Number(current.amountPaid ?? 0);
      // Never silently truncate an overpayment: the money left the bank, so the
      // ledger must show it. Refuse unless the caller says allowOverpay, then
      // record the real figure and flag it for recovery/credit-note follow-up.
      if (isOverpayment(alreadyPaid, paymentAmountInput, total)) {
        const outstanding = Math.max(0, total - alreadyPaid);
        if (body.allowOverpay !== true) {
          return NextResponse.json(
            {
              error: `RM ${paymentAmountInput.toFixed(2)} is more than the RM ${outstanding.toFixed(2)} still owed on this invoice. Check the receipt, or confirm the overpayment.`,
              code: "OVERPAYMENT",
              outstanding,
            },
            { status: 400 },
          );
        }
        extraFlags.push({
          code: "OVERPAID",
          message: `Paid RM ${(alreadyPaid + paymentAmountInput).toFixed(2)} against an invoice of RM ${total.toFixed(2)} (RM ${(alreadyPaid + paymentAmountInput - total).toFixed(2)} over). Recover or offset against the next bill.`,
          detectedAt: nowIso,
          meta: { amount: total, amountPaid: alreadyPaid + paymentAmountInput, confirmedById: caller.id },
        });
      }
      const newPaid = alreadyPaid + paymentAmountInput;
      data.amountPaid = newPaid;

      // Status reflects how much is paid + whether it lines up with deposit.
      const dep = current.depositAmount ? Number(current.depositAmount) : 0;
      if (newPaid >= total - 0.005) {
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
      data.amountPaid = current.amount;
    } else if (status === "DEPOSIT_PAID") {
      // Mirror amountPaid to depositAmount when the legacy "Pay Deposit"
      // button is used.
      if (current.depositAmount) {
        const dep = Number(current.depositAmount);
        const already = Number(current.amountPaid ?? 0);
        if (dep > already) data.amountPaid = dep;
      }
    }

    // ── Full-payment guards — whichever path lands on PAID ─────────────────
    if (data.status === "PAID") {
      // Settling a supplier bill in full is a manager-level act.
      if (!isPayerRole(caller.role)) {
        return NextResponse.json(
          { error: "Only an owner, admin or manager can mark an invoice paid.", code: "FORBIDDEN_PAYMENT_ROLE" },
          { status: 403 },
        );
      }
      // A purchase order with nothing received yet has no goods behind the bill.
      // INVOICE_PAY_REQUIRE_RECEIPT decides how hard to push back: "warn"
      // (default) pays but flags + warns; "block" refuses unless the payer
      // explicitly confirms (pre-payment terms exist). The flag is written in
      // both modes so the missing delivery stays visible on the invoice.
      if (current.order?.orderType === "PURCHASE_ORDER" && current.order._count.receivings === 0) {
        const mode = receiptRequirementMode(process.env.INVOICE_PAY_REQUIRE_RECEIPT);
        if (mode === "block" && body.payWithoutReceipt !== true) {
          return NextResponse.json(
            {
              error: "Nothing has been received against this purchase order yet. Record the delivery first, or confirm you are paying before receipt.",
              code: "NO_RECEIVING",
            },
            { status: 409 },
          );
        }
        extraFlags.push({
          code: "NO_RECEIVING_AT_PAYMENT",
          message: `Marked paid by ${caller.name} before any goods were received against the PO. Confirm delivery.`,
          detectedAt: nowIso,
          meta: { confirmedById: caller.id, mode, explicit: body.payWithoutReceipt === true },
        });
        warnings.push("Nothing has been received against this purchase order yet — paid before receipt.");
      }
      // Bill vs order total drift beyond max(RM5, 2%) — don't block (supplier
      // prices move, delivery charges appear) but make it visible.
      if (current.order && amountMismatchesOrder(Number(current.amount), Number(current.order.totalAmount))) {
        extraFlags.push({
          code: "AMOUNT_VS_ORDER_MISMATCH",
          message: `Invoice RM ${Number(current.amount).toFixed(2)} vs order total RM ${Number(current.order.totalAmount).toFixed(2)} at payment. Check the bill against the PO.`,
          detectedAt: nowIso,
          meta: { invoiceAmount: Number(current.amount), orderTotal: Number(current.order.totalAmount) },
        });
        warnings.push(
          `Invoice RM ${Number(current.amount).toFixed(2)} differs from the order total RM ${Number(current.order.totalAmount).toFixed(2)}.`,
        );
      }
    }

    if (extraFlags.length > 0) {
      flagsForWrite = mergeFlags(flagsForWrite ?? current.flags, extraFlags);
    }
    if (flagsForWrite !== undefined) data.flags = flagsForWrite as Prisma.InputJsonValue;

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

    return NextResponse.json(warnings.length > 0 ? { ...invoice, warnings } : invoice);
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
