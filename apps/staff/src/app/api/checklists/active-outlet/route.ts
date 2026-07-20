import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveOutletContext } from "@/lib/working-outlet";

export const dynamic = "force-dynamic";

// GET /api/checklists/active-outlet
// The outlet the caller should see checklists for = where they're actually
// working today (clocked-in → rostered → home). The list page uses this instead
// of the fixed home outlet so a covering staff / roving manager gets the right
// list and can auto-generate it.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await resolveOutletContext(session.id, session.outletId);

  let outletName: string | null = null;
  if (ctx.workingOutletId) {
    const outlet = await prisma.outlet.findUnique({
      where: { id: ctx.workingOutletId },
      select: { name: true },
    });
    outletName = outlet?.name ?? null;
  }

  return NextResponse.json({
    outletId: ctx.workingOutletId,
    outletName,
    source: ctx.workingSource,
    allowedOutletIds: ctx.allowedOutletIds,
  });
}
