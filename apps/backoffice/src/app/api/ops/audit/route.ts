import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/ops/audit
 * Full checklist data for manager audit review.
 * Params: date (required), outletId, status, sopId
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const date = url.searchParams.get("date");
  const outletId = url.searchParams.get("outletId");
  const status = url.searchParams.get("status");

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const d = new Date(date);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const where: Record<string, unknown> = { date: dateOnly };
  if (outletId) where.outletId = outletId;
  if (status) where.status = status;

  const checklists = await prisma.checklist.findMany({
    where,
    orderBy: [{ shift: "asc" }, { createdAt: "asc" }],
    include: {
      sop: { select: { id: true, title: true, category: { select: { name: true } } } },
      outlet: { select: { id: true, code: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
      items: {
        orderBy: { stepNumber: "asc" },
        include: {
          completedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Compute stats and flags per checklist
  const result = checklists.map((cl) => {
    const totalItems = cl.items.length;
    const completedItems = cl.items.filter((i) => i.isCompleted).length;
    const photoRequired = cl.items.filter((i) => i.photoRequired).length;
    const photosUploaded = cl.items.filter((i) => i.photoRequired && i.photoUrl).length;
    const missingPhotos = cl.items.filter((i) => i.photoRequired && !i.photoUrl).length;
    const hasIssues = missingPhotos > 0 || (totalItems > 0 && completedItems < totalItems);

    return {
      ...cl,
      totalItems,
      completedItems,
      progress: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      photoRequired,
      photosUploaded,
      missingPhotos,
      hasIssues,
    };
  });

  // Summary
  const total = result.length;
  const completed = result.filter((c) => c.status === "COMPLETED").length;
  const withIssues = result.filter((c) => c.hasIssues).length;
  const totalPhotosRequired = result.reduce((s, c) => s + c.photoRequired, 0);
  const totalPhotosUploaded = result.reduce((s, c) => s + c.photosUploaded, 0);

  return NextResponse.json({
    summary: { total, completed, withIssues, totalPhotosRequired, totalPhotosUploaded },
    checklists: result,
  });
}
