import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// PATCH /api/audits/[id]/items/[itemId] — update rating, notes, photos
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, itemId } = await params;
  const body = await req.json();
  const { rating, notes, photos, addPhoto, removePhoto } = body;

  // Verify the item belongs to this report
  const item = await prisma.auditReportItem.findFirst({
    where: { id: itemId, reportId: id },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Only the auditor / managers-in-outlet / admins may write item ratings —
  // not the staff member being audited. Mirrors PATCH /api/audits/[id]; without
  // it any staffer could rewrite ratings/notes/photos on any audit by id.
  const report = await prisma.auditReport.findUnique({
    where: { id },
    select: { auditorId: true, outletId: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  let allowed = isAdmin || report.auditorId === session.id;
  if (!allowed) {
    const me = await prisma.user.findUnique({
      where: { id: session.id },
      select: { moduleAccess: true, outletId: true, outletIds: true },
    });
    const ops = (me?.moduleAccess as Record<string, unknown> | null)?.["ops"];
    const hasAuditModule = ops === true || (Array.isArray(ops) && ops.includes("audit"));
    const myOutlets = new Set<string>([
      ...(me?.outletId ? [me.outletId] : []),
      ...(me?.outletIds ?? []),
    ]);
    allowed = hasAuditModule && myOutlets.has(report.outletId);
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (rating !== undefined) data.rating = rating;
  if (notes !== undefined) data.notes = notes;
  if (photos !== undefined) data.photos = photos;
  // Append a single photo
  if (addPhoto) {
    data.photos = [...(item.photos || []), addPhoto];
  }
  // Remove a photo by URL
  if (removePhoto) {
    data.photos = (item.photos || []).filter((p) => p !== removePhoto);
  }

  const updated = await prisma.auditReportItem.update({
    where: { id: itemId },
    data,
  });

  // Calculate report progress
  const [total, rated] = await Promise.all([
    prisma.auditReportItem.count({ where: { reportId: id } }),
    prisma.auditReportItem.count({ where: { reportId: id, rating: { not: null } } }),
  ]);

  return NextResponse.json({
    item: {
      id: updated.id,
      rating: updated.rating,
      notes: updated.notes,
      photos: updated.photos,
    },
    progress: { total, rated, percent: total > 0 ? Math.round((rated / total) * 100) : 0 },
  });
}
