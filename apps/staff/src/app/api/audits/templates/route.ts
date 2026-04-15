import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/audits/templates — list active templates (optionally filter by roleType)
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const roleType = searchParams.get("roleType");

  const where: Record<string, unknown> = { isActive: true };
  if (roleType) where.roleType = roleType;

  const templates = await prisma.auditTemplate.findMany({
    where,
    select: {
      id: true,
      name: true,
      description: true,
      roleType: true,
      sections: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          _count: { select: { items: true } },
        },
      },
      _count: { select: { reports: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(templates);
}
