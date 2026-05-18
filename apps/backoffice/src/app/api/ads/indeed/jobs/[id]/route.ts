import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH /api/ads/indeed/jobs/[id]
// Body: { outletId: string | null }
// Manual override of the city→outlet auto-mapping for a specific job.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { outletId?: string | null };

  if (!("outletId" in body)) {
    return NextResponse.json({ error: "outletId required (null to clear)" }, { status: 400 });
  }

  if (body.outletId) {
    const exists = await prisma.outlet.findUnique({ where: { id: body.outletId } });
    if (!exists) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  }

  const updated = await prisma.indeedAdsJob.update({
    where: { id },
    data:  { outletId: body.outletId },
    include: { outlet: { select: { id: true, code: true, name: true } } },
  });

  return NextResponse.json({
    id:         updated.id,
    outletId:   updated.outletId,
    outletName: updated.outlet?.name ?? null,
  });
}
