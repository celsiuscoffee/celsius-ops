import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/ads/indeed/settings — returns recent sync logs.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs = await prisma.indeedAdsSyncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 25,
  });

  return NextResponse.json({ logs });
}
