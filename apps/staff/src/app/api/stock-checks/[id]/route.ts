import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * DELETE /api/stock-checks/[id]
 *
 * Deletes a DRAFT stock count (and its items via FK cascade). Used by the
 * staff app's "Reset" button — without server-side deletion, the polling
 * fallback would re-hydrate the cleared local state from the surviving
 * DRAFT within 3 seconds.
 *
 * Refuses to delete SUBMITTED / REVIEWED counts to protect the audit trail.
 * Permission: any user at the count's outlet (or OWNER/ADMIN).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const count = await prisma.stockCount.findUnique({
    where: { id },
    select: { id: true, status: true, outletId: true },
  });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && count.outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot reset another outlet's count" }, { status: 403 });
  }

  if (count.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Cannot reset ${count.status} count — audit trail preserved` },
      { status: 409 },
    );
  }

  // FK cascade on StockCountItem.stockCountId handles item cleanup.
  await prisma.stockCount.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
