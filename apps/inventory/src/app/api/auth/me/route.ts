import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      passwordHash: true,
      username: true,
      moduleAccess: true,
      appAccess: true,
    },
  });

  // Extract inventory module permissions from moduleAccess JSON
  const moduleAccess = (user?.moduleAccess as Record<string, string[]>) ?? {};
  const permissions = moduleAccess["inventory"] ?? [];

  return NextResponse.json({
    ...session,
    permissions,
    appAccess: user?.appAccess ?? [],
    hasPassword: !!user?.passwordHash,
    username: user?.username ?? null,
  });
}
