import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { mintPlaceholderNumber } from "@/lib/inventory/placeholder-number";
import { getUserFromHeaders } from "@/lib/auth";
import { adjustStockByPackages } from "@/lib/stock";
import { guardReceiptPackages } from "@/lib/inventory/receipt-guard";
import { guardOrderLinePrices } from "@/lib/inventory/po-price-guard";
import { assertNoDuplicateInvoice } from "@/lib/inventory/invoice-dedupe";
import type { InvoiceFlag } from "@/lib/inventory/flag-detector";
import { isApprovableClaimStatus, isPayerRole, moneyHasMoved } from "@/lib/inventory/payment-guards";

type ClaimLine = { productId: string; productPackageId?: string | null; quantity: number; unitPrice: number };

/** Thrown inside a transaction to abort it with a ready-made HTTP response. */
class ClaimRefused extends Error {
  response: NextResponse;
  constructor(response: NextResponse) {
    super("claim action refused");
    this.response = response;
  }
}

const sumLines = (lines: ClaimLine[]) =>
  lines.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, supplierId, amount, notes, claimedById, purchaseDate, invoiceNumber } = body;
  const items: ClaimLine[] | undefined = Array.isArray(body.items) && body.items.length > 0 ? body.items : undefined;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      invoices: { orderBy: { createdAt: "asc" } },
      outlet: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const primaryInvoice = order.invoices[0];

  try {
    // ── Reject ──────────────────────────────────────────────────────────────
    if (action === "reject") {
      if (!isPayerRole(caller.role)) {
        return NextResponse.json({ error: "Only a manager, admin or owner can reject a claim." }, { status: 403 });
      }
      // A claim whose invoice has already been (partly) paid is a ledger
      // record, not a request — deleting it would erase the payment.
      const paid = order.invoices.find((inv) => moneyHasMoved(inv.status));
      if (paid) {
        return NextResponse.json(
          {
            error: `Invoice ${paid.invoiceNumber} on this claim is ${paid.status} — a paid claim cannot be rejected/deleted.`,
            code: "INVOICE_PAID",
          },
          { status: 409 },
        );
      }
      // Invoice(s), items, then the order — together, so a failure midway
      // (e.g. a receiving still referencing the order) leaves nothing half-deleted.
      await prisma.$transaction(async (tx) => {
        await tx.invoice.deleteMany({ where: { orderId: id } });
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.order.delete({ where: { id } });
      });

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // ── Save Draft ──────────────────────────────────────────────────────────
    if (action === "save") {
      const warnings: string[] = [];
      if (items) {
        // Replacing the lines on an approved claim would desync the receiving
        // and stock that approval already booked.
        if (!isApprovableClaimStatus(order.status)) {
          return NextResponse.json(
            { error: `Claim is ${order.status} — its items can no longer be edited.`, code: "ALREADY_APPROVED" },
            { status: 409 },
          );
        }
        const priceGuard = await guardOrderLinePrices(items, { override: body.overridePriceGuard === true });
        if (!priceGuard.ok) return priceGuard.response;
        warnings.push(...priceGuard.warnings);
      }

      const updateData: Record<string, unknown> = {};
      if (supplierId) updateData.supplierId = supplierId;
      if (notes !== undefined) updateData.notes = notes;
      if (purchaseDate) updateData.deliveryDate = new Date(purchaseDate);
      if (claimedById) updateData.claimedById = claimedById;

      // Items total takes precedence over a bare amount.
      const finalAmount: number | undefined = items
        ? sumLines(items)
        : typeof amount === "number" && amount > 0
          ? amount
          : undefined;
      if (finalAmount !== undefined) updateData.totalAmount = finalAmount;

      await prisma.$transaction(async (tx) => {
        if (items) {
          await tx.orderItem.deleteMany({ where: { orderId: id } });
          await tx.orderItem.createMany({
            data: items.map((i) => ({
              orderId: id,
              productId: i.productId,
              productPackageId: i.productPackageId || null,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              totalPrice: i.quantity * i.unitPrice,
            })),
          });
        }
        await tx.order.update({ where: { id }, data: updateData });

        if (primaryInvoice) {
          const invUpdate: Record<string, unknown> = {};
          if (supplierId) invUpdate.supplierId = supplierId;
          if (notes !== undefined) invUpdate.notes = notes;
          // Number and amount are locked once money has moved (see invoices/[id]).
          if (!moneyHasMoved(primaryInvoice.status)) {
            if (invoiceNumber) invUpdate.invoiceNumber = invoiceNumber;
            if (finalAmount !== undefined) invUpdate.amount = finalAmount;
          }
          if (Object.keys(invUpdate).length > 0) {
            await tx.invoice.update({ where: { id: primaryInvoice.id }, data: invUpdate });
          }
        }
      });

      return NextResponse.json({ success: true, action: "saved", ...(warnings.length ? { warnings } : {}) });
    }

    // ── Approve ─────────────────────────────────────────────────────────────
    if (action === "approve") {
      // Approval books stock and turns a request into a payable — manager-level.
      if (!isPayerRole(caller.role)) {
        return NextResponse.json({ error: "Only a manager, admin or owner can approve a claim." }, { status: 403 });
      }
      // Approving twice re-created the receiving and credited stock a second
      // time. Only a claim still awaiting approval can be approved (re-checked
      // under a row lock inside the transaction below).
      if (!isApprovableClaimStatus(order.status)) {
        return NextResponse.json(
          { error: `Claim is already ${order.status}.`, code: "ALREADY_APPROVED" },
          { status: 409 },
        );
      }

      const isIngredient = order.expenseCategory === "INGREDIENT";
      const isRequestFlow = order.orderType === "PAYMENT_REQUEST";
      const finalClaimedById: string | null = isRequestFlow ? null : (claimedById || order.claimedById);

      // Nobody approves their own reimbursement.
      if (finalClaimedById && finalClaimedById === caller.id) {
        return NextResponse.json(
          { error: "You cannot approve your own claim — ask another manager.", code: "SELF_APPROVAL" },
          { status: 403 },
        );
      }

      // Ingredients require itemized approval; asset/maintenance/other approve
      // on amount only.
      if (isIngredient && !items) {
        return NextResponse.json({ error: "Items are required for ingredient approval" }, { status: 400 });
      }

      const warnings: string[] = [];
      if (items) {
        const priceGuard = await guardOrderLinePrices(items, { override: body.overridePriceGuard === true });
        if (!priceGuard.ok) return priceGuard.response;
        warnings.push(...priceGuard.warnings);
      }

      // Resolve packages before the order is rewritten below — approving a
      // claim books stock, and an unresolved package books it at factor 1.
      const approvalResolved = isIngredient && items ? await guardReceiptPackages(items) : null;
      if (approvalResolved && !approvalResolved.ok) return approvalResolved.response;
      const resolved = approvalResolved?.ok ? approvalResolved.resolved : null;

      const finalSupplierId = supplierId || order.supplierId;
      // The approved amount is what the lines add up to. A body `amount` is only
      // honoured when there are no lines (asset/maintenance/other).
      const totalAmount = items
        ? sumLines(items)
        : typeof amount === "number" && amount > 0
          ? amount
          : Number(order.totalAmount);

      const paymentType = isRequestFlow ? "SUPPLIER" : "STAFF_CLAIM";
      const noteLabel = isRequestFlow
        ? `${order.expenseCategory.toLowerCase()} payment request approved`
        : `${order.expenseCategory.toLowerCase()} claim approved`;

      // Duplicate guard for the invoice we are about to create (none exists
      // yet). Number matches refuse unless overridden; same-amount matches are
      // advisory and become a flag.
      const newInvoiceFlags: InvoiceFlag[] = [];
      let newInvoiceNumber: string | null = null;
      if (!primaryInvoice) {
        const dedupe = await assertNoDuplicateInvoice(
          { supplierId: finalSupplierId, invoiceNumber: null, amount: totalAmount, issueDate: order.deliveryDate ?? new Date() },
          { override: body.overrideDuplicate === true },
        );
        if (!dedupe.ok) return dedupe.response;
        if (dedupe.match) {
          newInvoiceFlags.push({
            code: "DUPLICATE_SUSPECT",
            message: `Matches ${dedupe.match.invoiceNumber} (${dedupe.match.status}, RM ${dedupe.match.amount.toFixed(2)}, ${dedupe.match.issueDate}) — ${dedupe.match.reason.replace(/_/g, " ")}. Check before paying.`,
            detectedAt: new Date().toISOString(),
            meta: { match: dedupe.match, source: "pay-and-claim-approve" },
          });
        }
        newInvoiceNumber = await mintPlaceholderNumber(prisma, order.outletId);
      }

      await prisma.$transaction(
        async (tx) => {
          // Serialise concurrent approvals on this order; the loser sees COMPLETED.
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
          const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
          if (!fresh || !isApprovableClaimStatus(fresh.status)) {
            throw new ClaimRefused(
              NextResponse.json(
                { error: `Claim is already ${fresh?.status ?? "gone"}.`, code: "ALREADY_APPROVED" },
                { status: 409 },
              ),
            );
          }

          // 1. Order → COMPLETED with the approved lines
          await tx.orderItem.deleteMany({ where: { orderId: id } });
          await tx.order.update({
            where: { id },
            data: {
              status: "COMPLETED",
              supplierId: finalSupplierId,
              totalAmount,
              notes: notes ?? order.notes,
              deliveryDate: purchaseDate ? new Date(purchaseDate) : order.deliveryDate,
              claimedById: finalClaimedById,
              ...(items
                ? {
                    items: {
                      create: items.map((i, idx) => ({
                        productId: i.productId,
                        productPackageId: resolved?.[idx]?.productPackageId ?? i.productPackageId ?? null,
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                        totalPrice: i.quantity * i.unitPrice,
                      })),
                    },
                  }
                : {}),
            },
          });

          // 2. Receiving + stock — INGREDIENT only. Asset/maintenance/other
          //    never touch stock. Same transaction, same client.
          if (isIngredient && items && resolved) {
            await tx.receiving.create({
              data: {
                orderId: id,
                outletId: order.outletId,
                supplierId: finalSupplierId,
                receivedById: caller.id,
                status: "COMPLETE",
                notes: notes ? `Pay & Claim approved: ${notes}` : "Pay & Claim approved",
                invoicePhotos: primaryInvoice?.photos ?? [],
                items: {
                  create: items.map((i, idx) => ({
                    productId: i.productId,
                    productPackageId: resolved[idx].productPackageId,
                    orderedQty: i.quantity,
                    receivedQty: i.quantity,
                  })),
                },
              },
            });

            await adjustStockByPackages(
              order.outletId,
              items.map((i, idx) => ({
                productId: i.productId,
                productPackageId: resolved[idx].productPackageId,
                quantity: i.quantity,
              })),
              tx,
            );
          }

          // 3. Invoice → PENDING (or create one)
          if (primaryInvoice) {
            await tx.invoice.update({
              where: { id: primaryInvoice.id },
              data: {
                status: "PENDING",
                amount: totalAmount,
                supplierId: finalSupplierId,
                notes: notes ? `${noteLabel}: ${notes}` : noteLabel,
              },
            });
          } else {
            await tx.invoice.create({
              data: {
                invoiceNumber: newInvoiceNumber!,
                orderId: id,
                outletId: order.outletId,
                supplierId: finalSupplierId,
                amount: totalAmount,
                status: "PENDING",
                paymentType,
                expenseCategory: order.expenseCategory,
                claimedById: finalClaimedById,
                photos: [],
                notes: notes ? `${noteLabel}: ${notes}` : noteLabel,
                ...(newInvoiceFlags.length > 0
                  ? { flags: newInvoiceFlags as unknown as Prisma.InputJsonValue }
                  : {}),
              },
            });
          }
        },
        { timeout: 20_000 },
      );

      return NextResponse.json({ success: true, action: "approved", ...(warnings.length ? { warnings } : {}) });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    if (err instanceof ClaimRefused) return err.response;
    console.error("[pay-and-claim/[id] PATCH]", err);
    const message = err instanceof Error ? err.message : "Failed to update claim";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
