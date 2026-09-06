import { NextResponse, NextRequest } from "next/server";
import type { Prisma } from "@celsius/db";
import { resolveReceiptPackages } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";
import { computeDepositAmount } from "@/lib/inventory/deposit";
import { isPlaceholderNumber, mintPlaceholderNumber } from "@/lib/inventory/placeholder-number";
import { assertNoDuplicateInvoice } from "@/lib/inventory/invoice-dedupe";
import type { InvoiceFlag } from "@/lib/inventory/flag-detector";
import {
  canReceiveOrder,
  canReceiveTransfer,
  isPayerRole,
  orderNotReceivableMessage,
} from "@/lib/inventory/payment-guards";

export async function GET(req: NextRequest) {
  // Auto-reconcile: fix PO statuses where receivings exist but the order is
  // still "awaiting" (stale rows from before the POST set status itself).
  // Judged PER LINE against the ORIGINAL ordered qty snapshotted on receiving
  // items — OrderItem.quantity is overwritten by the POST reconcile, so the
  // old aggregate compare (sum received vs current quantity) always read
  // "complete" for short POs, and over-receipt on one line could mask a
  // shortage on another.
  try {
    const staleOrders = await prisma.order.findMany({
      where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] } },
      select: { id: true },
    });
    for (const order of staleOrders) {
      const receivings = await prisma.receiving.findMany({
        where: { orderId: order.id },
        select: { items: { select: { productId: true, productPackageId: true, receivedQty: true, orderedQty: true } } },
      });
      if (receivings.length === 0) continue;
      const cumulative = new Map<string, number>();
      const originalOrdered = new Map<string, number>();
      for (const r of receivings) {
        for (const it of r.items) {
          const key = `${it.productId}::${it.productPackageId ?? ""}`;
          cumulative.set(key, (cumulative.get(key) ?? 0) + Number(it.receivedQty));
          if (it.orderedQty != null) {
            originalOrdered.set(key, Math.max(originalOrdered.get(key) ?? 0, Number(it.orderedQty)));
          }
        }
      }
      let stillShort = false;
      for (const [key, cum] of cumulative) {
        const ordered = originalOrdered.get(key);
        if (ordered !== undefined && cum < ordered) {
          stillShort = true;
          break;
        }
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { status: stillShort ? "PARTIALLY_RECEIVED" : "COMPLETED" },
      });
    }
  } catch (err) {
    console.error("[receivings] Auto-reconcile failed:", err);
  }

  const tab = req.nextUrl.searchParams.get("tab") || "recent";
  const search = req.nextUrl.searchParams.get("search") || "";

  const orderId = req.nextUrl.searchParams.get("orderId") || "";

  const where: Record<string, unknown> = {};
  if (orderId) {
    where.orderId = orderId;
  } else if (tab === "recent") {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.receivedAt = { gte: thirtyDaysAgo };
  }

  if (search) {
    where.OR = [
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const receivings = await prisma.receiving.findMany({
    where,
    take: 100,
    select: {
      id: true,
      orderId: true,
      transferId: true,
      status: true,
      notes: true,
      invoicePhotos: true,
      receivedAt: true,
      order: { select: { orderNumber: true } },
      transfer: { select: { fromOutlet: { select: { name: true } } } },
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        select: {
          id: true,
          orderedQty: true,
          receivedQty: true,
          expiryDate: true,
          discrepancyReason: true,
          product: { select: { name: true, sku: true } },
          productPackage: { select: { packageLabel: true } },
        },
      },
    },
    orderBy: { receivedAt: "desc" },
  });

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    transferId: r.transferId,
    orderNumber: r.order?.orderNumber ?? (r.transferId ? "Transfer" : "Ad-hoc"),
    outlet: r.outlet.name,
    supplier: r.supplier?.name ?? r.transfer?.fromOutlet?.name ?? "Transfer",
    receivedBy: r.receivedBy.name,
    receivedAt: r.receivedAt.toISOString(),
    status: r.status,
    notes: r.notes,
    photoCount: r.invoicePhotos.length,
    items: r.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? "",
      orderedQty: i.orderedQty ? Number(i.orderedQty) : null,
      receivedQty: Number(i.receivedQty),
      expiryDate: i.expiryDate?.toISOString().split("T")[0] ?? null,
      discrepancyReason: i.discrepancyReason,
    })),
  }));

  return NextResponse.json(mapped);
}


type ReceivingLine = {
  productId: string;
  productPackageId?: string | null;
  orderedQty?: number | null;
  receivedQty: number;
  expiryDate?: string;
  discrepancyReason?: string;
  unitPrice?: number;
};

/** Thrown inside the transaction to abort it with a ready-made HTTP response. */
class ReceivingRefused extends Error {
  response: NextResponse;
  constructor(response: NextResponse) {
    super("receiving refused");
    this.response = response;
  }
}
const refuse = (payload: Record<string, unknown>, status: number) =>
  new ReceivingRefused(NextResponse.json(payload, { status }));

const RECEIVING_STATUSES = new Set(["COMPLETE", "PARTIAL", "DISPUTED"]);

/**
 * POST /api/inventory/receivings
 *
 * One receiving = one transaction. Everything that must agree — the receiving
 * row, the stock credit, the PO line reconcile + order status, the transfer
 * status, and the GRNI placeholder invoice — commits or rolls back together.
 * The order (or transfer) row is locked FOR UPDATE first, so two concurrent
 * posts against the same PO serialise: the second one sees the status the
 * first one wrote and is refused instead of booking the goods twice.
 *
 * Context comes from the server-side record, never the client: with an
 * orderId the outlet, supplier and ordered quantities are the PO's; with a
 * transferId the outlet is the transfer's destination. Only an ad-hoc
 * receiving (neither) takes outletId/supplierId from the body, and that is
 * limited to owner/admin/manager.
 */
export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { orderId, transferId, notes, status, invoicePhotos } = body;
  const items: ReceivingLine[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items are required" }, { status: 400 });
  }
  for (const i of items) {
    if (!i?.productId || !Number.isFinite(Number(i.receivedQty)) || Number(i.receivedQty) < 0) {
      return NextResponse.json({ error: "Every item needs a productId and a non-negative receivedQty" }, { status: 400 });
    }
  }

  const isTransfer = !!transferId;
  const isAdHoc = !orderId && !transferId;
  if (isAdHoc) {
    // No PO and no transfer means nothing to reconcile against — stock appears
    // from nowhere and a payable is minted from client-supplied prices. Keep it
    // to people who can be asked why.
    if (!isPayerRole(caller.role)) {
      return NextResponse.json(
        { error: "Ad-hoc receivings (no PO, no transfer) require a manager, admin or owner.", code: "ADHOC_RECEIVING_FORBIDDEN" },
        { status: 403 },
      );
    }
    if (!body.outletId) {
      return NextResponse.json({ error: "outletId is required for an ad-hoc receiving" }, { status: 400 });
    }
  }

  const photos: string[] = Array.isArray(invoicePhotos) ? invoicePhotos : [];

  try {
    const receiving = await prisma.$transaction(
      async (tx) => {
        // ── 1. Resolve context from the server-side record (under lock) ─────
        let outletId: string;
        let supplierId: string | null = null;
        // Ordered qty per PO line, keyed product::package. This is the ONLY
        // surviving record of what was ordered, because the reconcile below
        // overwrites OrderItem.quantity with the received total.
        const orderedQtyMap = new Map<string, number>();
        // PO package per product — a client that omits productPackageId still
        // books stock in base UOM via the PO line's package.
        const poPkgMap = new Map<string, string | null>();

        if (orderId) {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              status: true,
              outletId: true,
              supplierId: true,
              items: { select: { productId: true, productPackageId: true, quantity: true } },
            },
          });
          if (!order) throw refuse({ error: "Order not found" }, 404);
          // Receivable from SENT onwards — without this a stale client could
          // "receive" a COMPLETED/CANCELLED PO, overwriting its line quantities
          // and flipping its status back. Checked under the row lock, so a
          // concurrent second post sees COMPLETED and stops here.
          if (!canReceiveOrder(order.status)) {
            throw refuse({ error: orderNotReceivableMessage(order.status), code: "ORDER_NOT_RECEIVABLE" }, 400);
          }
          outletId = order.outletId;
          supplierId = order.supplierId;
          for (const oi of order.items) {
            orderedQtyMap.set(`${oi.productId}::${oi.productPackageId ?? ""}`, Number(oi.quantity));
            if (!poPkgMap.has(oi.productId)) poPkgMap.set(oi.productId, oi.productPackageId ?? null);
          }
        } else if (isTransfer) {
          await tx.$queryRaw`SELECT id FROM "StockTransfer" WHERE id = ${transferId} FOR UPDATE`;
          const transfer = await tx.stockTransfer.findUnique({
            where: { id: transferId },
            select: { status: true, toOutletId: true },
          });
          if (!transfer) throw refuse({ error: "Transfer not found" }, 404);
          // RECEIVED is reachable only from PENDING / APPROVED / IN_TRANSIT. A
          // transfer already RECEIVED/COMPLETED would credit the destination
          // twice; a DRAFT/CANCELLED one was never dispatched.
          if (!canReceiveTransfer(transfer.status)) {
            throw refuse(
              { error: `Transfer is ${transfer.status} and cannot be received.`, code: "TRANSFER_NOT_RECEIVABLE" },
              409,
            );
          }
          outletId = transfer.toOutletId;
        } else {
          outletId = String(body.outletId);
          supplierId = body.supplierId ? String(body.supplierId) : null;
        }

        // Ordered qty: from the PO when there is one (never the client's
        // figure); the client's own number only for ad-hoc / transfer lines.
        const resolveOrderedQty = (i: ReceivingLine): number | null => {
          if (orderId) return orderedQtyMap.get(`${i.productId}::${i.productPackageId ?? ""}`) ?? null;
          return i.orderedQty ?? null;
        };

        let receivingStatus: string = typeof status === "string" && RECEIVING_STATUSES.has(status) ? status : "COMPLETE";
        if (orderId) {
          const hasShort = items.some((i) => {
            const ordered = resolveOrderedQty(i);
            return ordered !== null && Number(i.receivedQty) < ordered;
          });
          if (hasShort) receivingStatus = "PARTIAL";
        }

        // ── 2. Resolve every line to a package before writing ─────────────
        // A line that omits productPackageId used to be booked at factor 1 —
        // cartons recorded as grams. Resolve from the PO line where possible;
        // a genuinely ambiguous line is refused instead of guessed.
        const recvLines = items.map((i) => ({ productId: i.productId, productPackageId: i.productPackageId ?? null }));
        const recvProductIds = [...new Set(recvLines.map((l) => l.productId))];
        const pkgOptions = await tx.productPackage.findMany({
          where: { productId: { in: recvProductIds } },
          select: { id: true, productId: true, packageLabel: true, conversionFactor: true },
        });
        const recvProducts = await tx.product.findMany({
          where: { id: { in: recvProductIds } },
          select: { id: true, name: true },
        });
        const resolution = resolveReceiptPackages(recvLines, {
          packages: pkgOptions.map((p) => ({ ...p, conversionFactor: Number(p.conversionFactor) })),
          poPackageByProduct: poPkgMap,
          productNames: new Map(recvProducts.map((p) => [p.id, p.name])),
        });
        if (!resolution.ok) {
          throw refuse(
            { error: "Choose a package for every item before receiving.", details: resolution.errors.map((e) => e.message) },
            400,
          );
        }
        const resolved = resolution.resolved;

        // ── 3. Receiving row ──────────────────────────────────────────────
        const created = await tx.receiving.create({
          data: {
            orderId: orderId || null,
            transferId: transferId || null,
            outletId,
            supplierId,
            receivedById: caller.id,
            status: receivingStatus as "COMPLETE" | "PARTIAL" | "DISPUTED",
            notes: notes || null,
            invoicePhotos: photos,
            items: {
              create: items.map((i, idx) => ({
                productId: i.productId,
                productPackageId: resolved[idx].productPackageId,
                orderedQty: resolveOrderedQty(i),
                receivedQty: Number(i.receivedQty),
                expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
                discrepancyReason: i.discrepancyReason || null,
              })),
            },
          },
        });

        // ── 4. Stock — package units × factor → base UOM on the canonical row ─
        const baseTotals = new Map<string, number>();
        items.forEach((i, idx) => {
          const qty = Number(i.receivedQty);
          if (!Number.isFinite(qty)) return;
          const base = qty * resolved[idx].conversionFactor;
          baseTotals.set(i.productId, (baseTotals.get(i.productId) ?? 0) + base);
        });
        for (const [productId, baseQty] of baseTotals) {
          await adjustStockBalance(outletId, productId, baseQty, null, tx);
        }

        // ── 5. PO reconciliation ──────────────────────────────────────────
        // Hard-overwrite each PO line to the cumulative receivedQty across all
        // receivings on this PO, so the PO total matches what the supplier
        // should actually invoice. Discrepancy is preserved on the receiving
        // rows (orderedQty vs receivedQty).
        let orderTotalAfter: number | null = null;
        if (orderId) {
          const allReceivings = await tx.receiving.findMany({
            where: { orderId },
            select: { items: { select: { productId: true, productPackageId: true, receivedQty: true, orderedQty: true } } },
          });
          const cumulativeByLine = new Map<string, number>();
          const originalOrdered = new Map<string, number>();
          for (const r of allReceivings) {
            for (const it of r.items) {
              const key = `${it.productId}::${it.productPackageId ?? ""}`;
              cumulativeByLine.set(key, (cumulativeByLine.get(key) ?? 0) + Number(it.receivedQty));
              if (it.orderedQty != null) {
                originalOrdered.set(key, Math.max(originalOrdered.get(key) ?? 0, Number(it.orderedQty)));
              }
            }
          }
          // Short-delivery detection against the ORIGINAL ordered qty (MAX of
          // the per-receiving snapshots — OrderItem.quantity is overwritten below).
          let stillShort = false;
          for (const [key, cum] of cumulativeByLine) {
            const ordered = originalOrdered.get(key);
            if (ordered !== undefined && cum < ordered) {
              stillShort = true;
              break;
            }
          }

          const orderItems = await tx.orderItem.findMany({
            where: { orderId },
            select: { id: true, productId: true, productPackageId: true, unitPrice: true, quantity: true },
          });
          let newTotalAmount = 0;
          for (const oi of orderItems) {
            const key = `${oi.productId}::${oi.productPackageId ?? ""}`;
            const cumReceived = cumulativeByLine.get(key);
            const newQty = cumReceived ?? Number(oi.quantity);
            const lineTotal = newQty * Number(oi.unitPrice);
            newTotalAmount += lineTotal;
            if (cumReceived !== undefined && cumReceived !== Number(oi.quantity)) {
              await tx.orderItem.update({ where: { id: oi.id }, data: { quantity: cumReceived, totalPrice: lineTotal } });
            }
          }

          // A short delivery leaves the PO PARTIALLY_RECEIVED (still receivable,
          // still chased) instead of force-completing. Fully received → COMPLETED.
          await tx.order.update({
            where: { id: orderId },
            data: { totalAmount: newTotalAmount, status: stillShort ? "PARTIALLY_RECEIVED" : "COMPLETED" },
          });
          orderTotalAfter = newTotalAmount;
        }

        // ── 6. Transfer → RECEIVED (status was verified under the lock) ───
        if (isTransfer) {
          await tx.stockTransfer.update({
            where: { id: transferId },
            data: { status: "RECEIVED", receivedById: caller.id, receivedAt: new Date(), completedAt: new Date() },
          });
        }

        // ── 7. Supplier invoice (non-transfer) ────────────────────────────
        // Existing PLACEHOLDER (GRNI-… / legacy INV-…, null due date, PENDING —
        // supplier hasn't sent the real invoice yet): sync its amount to the
        // freshly-reconciled PO total and append any new photos. An already-
        // attached invoice (real number, due date, possibly PAID) keeps its
        // amount — finance owns that record. No invoice yet → mint a placeholder.
        if (!isTransfer) {
          const existingForOrder = orderId
            ? await tx.invoice.findFirst({
                where: { orderId },
                orderBy: { createdAt: "desc" },
                select: { id: true, invoiceNumber: true, dueDate: true, status: true },
              })
            : null;

          if (existingForOrder) {
            const isPlaceholder =
              isPlaceholderNumber(existingForOrder.invoiceNumber) &&
              existingForOrder.dueDate == null &&
              existingForOrder.status === "PENDING";
            const updateData: Record<string, unknown> = {};
            if (photos.length > 0) updateData.photos = { push: photos };
            if (isPlaceholder && orderTotalAfter != null) updateData.amount = orderTotalAfter;
            if (Object.keys(updateData).length > 0) {
              await tx.invoice.update({ where: { id: existingForOrder.id }, data: updateData });
            }
          } else {
            const totalAmount =
              orderTotalAfter ?? items.reduce((s, i) => s + Number(i.receivedQty) * (i.unitPrice ?? 0), 0);

            // Duplicate guard. A minted placeholder has no number to compare, so
            // only a same-supplier same-amount match can fire — advisory (flag),
            // never a refusal, unless the helper decides otherwise.
            const dedupe = await assertNoDuplicateInvoice(
              { supplierId, invoiceNumber: null, amount: totalAmount, issueDate: new Date() },
              { override: body.overrideDuplicate === true },
            );
            if (!dedupe.ok) throw new ReceivingRefused(dedupe.response);
            const flags: InvoiceFlag[] = [];
            if (dedupe.match) {
              flags.push({
                code: "DUPLICATE_SUSPECT",
                message: `Matches ${dedupe.match.invoiceNumber} (${dedupe.match.status}, RM ${dedupe.match.amount.toFixed(2)}, ${dedupe.match.issueDate}) — ${dedupe.match.reason.replace(/_/g, " ")}. Check before paying.`,
                detectedAt: new Date().toISOString(),
                meta: { match: dedupe.match, source: "receiving" },
              });
            }

            const invoiceNumber = await mintPlaceholderNumber(prisma, outletId);
            const depositAmount = await computeDepositAmount(supplierId, Number(totalAmount));
            await tx.invoice.create({
              data: {
                invoiceNumber,
                orderId: orderId || null,
                outletId,
                supplierId,
                amount: totalAmount,
                status: "PENDING",
                photos,
                notes: notes ? `From receiving: ${notes}` : null,
                ...(depositAmount ? { depositAmount } : {}),
                ...(flags.length > 0 ? { flags: flags as unknown as Prisma.InputJsonValue } : {}),
              },
            });
          }
        }

        return created;
      },
      { timeout: 20_000 },
    );

    return NextResponse.json(receiving, { status: 201 });
  } catch (err) {
    if (err instanceof ReceivingRefused) return err.response;
    console.error("[receivings POST]", err);
    const message = err instanceof Error ? err.message : "Failed to record receiving";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
