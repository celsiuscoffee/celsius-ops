import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/audits/outlets — list outlets the caller may audit.
// OWNER/ADMIN see every active outlet; others see only outlets in their
// assignment set (outletId scalar + outletIds array).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";

  const where: { status: "ACTIVE"; id?: { in: string[] } } = { status: "ACTIVE" };

  if (!isAdmin) {
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { outletId: true, outletIds: true },
    });
    const allowed = Array.from(
      new Set([
        ...(user?.outletId ? [user.outletId] : []),
        ...(user?.outletIds ?? []),
      ]),
    );
    if (allowed.length === 0) return NextResponse.json([]);
    where.id = { in: allowed };
  }

  const outlets = await prisma.outlet.findMany({
    where,
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(outlets);
}
