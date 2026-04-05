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
    select: { password: true, username: true, permissions: true },
  });

  return NextResponse.json({
    ...session,
    permissions: user?.permissions ?? [],
    hasPassword: !!user?.password,
    username: user?.username ?? null,
  });
}
