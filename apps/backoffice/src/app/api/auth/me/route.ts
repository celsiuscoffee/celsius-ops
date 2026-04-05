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
    select: { passwordHash: true, username: true, moduleAccess: true },
  });

  // Extract backoffice-relevant permissions from moduleAccess JSON
  const moduleAccess = (user?.moduleAccess as Record<string, string[]> | null) ?? {};
  const backofficePermissions = moduleAccess.backoffice ?? [];

  return NextResponse.json({
    ...session,
    hasPassword: !!user?.passwordHash,
    username: user?.username ?? null,
    permissions: backofficePermissions,
  });
}
