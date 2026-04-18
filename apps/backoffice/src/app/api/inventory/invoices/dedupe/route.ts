import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/inventory/invoices/dedupe
 *
 * One-shot cleanup for the bug where `POST /api/inventory/receivings`
 * used to create a duplicate PENDING invoice even when the PO already
 * had a PAID one. Those duplicates show up under "Payable" and create
 * a double-payment risk.
 *
 * Safe-by-default:
 * - OWNER-only.
 * - Dry-run unless `?confirm=true` is passed — the dry-run returns
 *   exactly what would be merged/deleted with no DB mutation.
 * - Per order, the invoice with the strongest settlement status wins
 *   (PAID > DEPOSIT_PAID > PENDING/INITIATED/OVERDUE > DRAFT). If no
 *   invoice for that order is settled, NOTHING is deleted — we refuse
 *   to pick a winner when there is no paid one.
 * - Photos, popShortLink, paymentRef, paidAt and paidVia are merged
 *   from the loser into the survivor before deletion, so the POP
 *   evidence is never lost.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const confirm = req.nextUrl.searchParams.get("confirm") === "true";

  // Pull every order that has more than one invoice attached.
  const grouped = await prisma.invoice.groupBy({
    by: ["orderId"],
    where: { orderId: { not: null } },
    _count: { _all: true },
    having: { orderId: { _count: { gt: 1 } } },
  });

  type Action = {
    orderId: string;
    survivor: { invoiceNumber: string; status: string };
    removed: { invoiceNumber: string; status: string }[];
    mergedPhotos: number;
    mergedShortLink: boolean;
    mergedPaymentRef: boolean;
  };
  type Skipped = {
    orderId: string;
    reason: string;
    invoices: { invoiceNumber: string; status: string }[];
  };

  const actions: Action[] = [];
  const skipped: Skipped[] = [];

  const statusPriority: Record<string, number> = {
    PAID: 5,
    DEPOSIT_PAID: 4,
    OVERDUE: 3,
    PENDING: 2,
    INITIATED: 2,
    DRAFT: 1,
  };

  for (const row of grouped) {
    if (!row.orderId) continue;

    const invoices = await prisma.invoice.findMany({
      where: { orderId: row.orderId },
      orderBy: { createdAt: "asc" },
    });

    if (invoices.length < 2) continue;

    // Determine the survivor — the most-settled invoice.
    const ranked = [...invoices].sort((a, b) => {
      const pa = statusPriority[a.status] ?? 0;
      const pb = statusPriority[b.status] ?? 0;
      if (pa !== pb) return pb - pa;
      // Tie-breaker: oldest wins (the original one, before the duplicate was spawned).
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const survivor = ranked[0];
    const losers = ranked.slice(1);

    // Refuse to merge if none of the invoices is settled — we cannot
    // safely pick a winner when nothing is paid.
    if (!["PAID", "DEPOSIT_PAID"].includes(survivor.status)) {
      skipped.push({
        orderId: row.orderId,
        reason: "no PAID/DEPOSIT_PAID invoice among duplicates — manual review needed",
        invoices: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, status: i.status })),
      });
      continue;
    }

    // Build the merge payload for the survivor.
    const mergedPhotos = new Set<string>(survivor.photos);
    for (const loser of losers) {
      for (const p of loser.photos) mergedPhotos.add(p);
    }
    const extraPhotos = [...mergedPhotos].filter((p) => !survivor.photos.includes(p));

    // Only copy these if the survivor doesn't already have them.
    const firstLoserWithShortLink = losers.find((l) => !!l.popShortLink);
    const firstLoserWithRef = losers.find((l) => !!l.paymentRef);
    const firstLoserPaid = losers.find((l) => !!l.paidAt);

    const mergePayload: Record<string, unknown> = {};
    if (extraPhotos.length > 0) {
      mergePayload.photos = { push: extraPhotos };
    }
    if (!survivor.popShortLink && firstLoserWithShortLink?.popShortLink) {
      mergePayload.popShortLink = firstLoserWithShortLink.popShortLink;
    }
    if (!survivor.paymentRef && firstLoserWithRef?.paymentRef) {
      mergePayload.paymentRef = firstLoserWithRef.paymentRef;
    }
    if (!survivor.paidAt && firstLoserPaid?.paidAt) {
      mergePayload.paidAt = firstLoserPaid.paidAt;
      if (!survivor.paidVia && firstLoserPaid.paidVia) {
        mergePayload.paidVia = firstLoserPaid.paidVia;
      }
    }

    actions.push({
      orderId: row.orderId,
      survivor: { invoiceNumber: survivor.invoiceNumber, status: survivor.status },
      removed: losers.map((l) => ({ invoiceNumber: l.invoiceNumber, status: l.status })),
      mergedPhotos: extraPhotos.length,
      mergedShortLink: mergePayload.popShortLink !== undefined,
      mergedPaymentRef: mergePayload.paymentRef !== undefined,
    });

    if (!confirm) continue;

    // Apply the cleanup in a transaction so we never lose evidence.
    await prisma.$transaction(async (tx) => {
      if (Object.keys(mergePayload).length > 0) {
        await tx.invoice.update({ where: { id: survivor.id }, data: mergePayload });
      }
      await tx.invoice.deleteMany({ where: { id: { in: losers.map((l) => l.id) } } });
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun: !confirm,
    ordersAffected: actions.length,
    invoicesToRemove: actions.reduce((s, a) => s + a.removed.length, 0),
    skipped,
    actions,
  });
}
