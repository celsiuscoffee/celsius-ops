import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller || caller.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const module = searchParams.get("module");
  const userId = searchParams.get("userId");
  const limit = parseInt(searchParams.get("limit") || "100");

  const where: Record<string, unknown> = {};
  if (module) where.module = module;
  if (userId) where.userId = userId;

  const logs = await prisma.activityLog.findMany({
    where,
    include: {
      user: { select: { name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
  });

  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      action: l.action,
      module: l.module,
      details: l.details,
      targetId: l.targetId,
      targetName: l.targetName,
      userName: l.user.name,
      userRole: l.user.role,
      createdAt: l.createdAt.toISOString(),
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userId, action, module, details, targetId, targetName } = body;

  if (!userId || !action || !module) {
    return NextResponse.json({ error: "userId, action, module required" }, { status: 400 });
  }

  const log = await prisma.activityLog.create({
    data: { userId, action, module, details, targetId, targetName },
  });

  return NextResponse.json(log, { status: 201 });
}
