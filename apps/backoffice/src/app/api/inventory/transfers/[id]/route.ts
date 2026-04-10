import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  PENDING: ["COMPLETED", "CANCELLED"],
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, rejectionReason } = body;

    const user = await getUserFromHeaders(req.headers);

    const existing = await prisma.stockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${existing.status} to ${status}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { status };

    // DRAFT -> PENDING_APPROVAL: just update status
    if (existing.status === "DRAFT" && status === "PENDING_APPROVAL") {
      // No additional data needed
    }

    // PENDING_APPROVAL -> APPROVED: set approvedBy, subtract stock from source
    if (existing.status === "PENDING_APPROVAL" && status === "APPROVED") {
      if (user) {
        data.approvedById = user.id;
      }
      data.approvedAt = new Date();
    }

    // PENDING_APPROVAL -> CANCELLED (rejection)
    if (existing.status === "PENDING_APPROVAL" && status === "CANCELLED") {
      if (user) {
        data.rejectedById = user.id;
      }
      data.rejectedAt = new Date();
      if (rejectionReason) {
        data.rejectionReason = rejectionReason;
      }
    }

    // APPROVED -> IN_TRANSIT: just update status
    if (existing.status === "APPROVED" && status === "IN_TRANSIT") {
      // No additional data needed
    }

    // APPROVED/IN_TRANSIT -> CANCELLED: return stock to source (since subtracted on approval)
    if ((existing.status === "APPROVED" || existing.status === "IN_TRANSIT") && status === "CANCELLED") {
      if (rejectionReason) {
        data.rejectionReason = rejectionReason;
      }
    }

    // IN_TRANSIT -> RECEIVED: set receivedBy, add stock to destination
    if (existing.status === "IN_TRANSIT" && status === "RECEIVED") {
      if (user) {
        data.receivedById = user.id;
      }
      data.receivedAt = new Date();
      data.completedAt = new Date();
    }

    // PENDING -> COMPLETED (legacy)
    if (existing.status === "PENDING" && status === "COMPLETED") {
      data.completedAt = new Date();
    }

    // PENDING -> CANCELLED (legacy)
    if (existing.status === "PENDING" && status === "CANCELLED") {
      if (rejectionReason) {
        data.rejectionReason = rejectionReason;
      }
    }

    const transfer = await prisma.$transaction(async (tx) => {
      const updated = await tx.stockTransfer.update({
        where: { id },
        data,
        include: {
          items: true,
          approvedBy: true,
          receivedBy: true,
          rejectedBy: true,
          fromOutlet: true,
          toOutlet: true,
          transferredBy: true,
        },
      });

      // Stock movements based on transition
      // PENDING_APPROVAL -> APPROVED: subtract stock from source outlet
      if (existing.status === "PENDING_APPROVAL" && status === "APPROVED") {
        for (const item of updated.items) {
          await adjustStockBalance(updated.fromOutletId, item.productId, -Number(item.quantity));
        }
      }

      // IN_TRANSIT -> RECEIVED: add stock to destination outlet
      // Skip if a receiving record already exists (stock was added by the receivings POST)
      if (existing.status === "IN_TRANSIT" && status === "RECEIVED") {
        const existingReceiving = await tx.receiving.findFirst({
          where: { transferId: id },
        });
        if (!existingReceiving) {
          for (const item of updated.items) {
            await adjustStockBalance(updated.toOutletId, item.productId, Number(item.quantity));
          }
        }
      }

      // APPROVED/IN_TRANSIT -> CANCELLED: return stock to source outlet
      if ((existing.status === "APPROVED" || existing.status === "IN_TRANSIT") && status === "CANCELLED") {
        for (const item of updated.items) {
          await adjustStockBalance(updated.fromOutletId, item.productId, Number(item.quantity));
        }
      }

      // PENDING -> COMPLETED (legacy): add stock to destination
      if (existing.status === "PENDING" && status === "COMPLETED") {
        for (const item of updated.items) {
          await adjustStockBalance(updated.toOutletId, item.productId, Number(item.quantity));
        }
      }

      // PENDING -> CANCELLED (legacy): return stock to source
      if (existing.status === "PENDING" && status === "CANCELLED") {
        for (const item of updated.items) {
          await adjustStockBalance(updated.fromOutletId, item.productId, Number(item.quantity));
        }
      }

      return updated;
    });

    // Map response with user names
    const response = {
      id: transfer.id,
      status: transfer.status,
      fromOutlet: transfer.fromOutlet.name,
      toOutlet: transfer.toOutlet.name,
      transferredBy: transfer.transferredBy.name,
      approvedBy: transfer.approvedBy?.name ?? null,
      approvedAt: transfer.approvedAt?.toISOString() ?? null,
      receivedBy: transfer.receivedBy?.name ?? null,
      receivedAt: transfer.receivedAt?.toISOString() ?? null,
      rejectionReason: transfer.rejectionReason ?? null,
      completedAt: transfer.completedAt?.toISOString() ?? null,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[transfers/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
