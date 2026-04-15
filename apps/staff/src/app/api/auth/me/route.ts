import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Fetch moduleAccess from DB (not in JWT)
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true },
  });

  return NextResponse.json(
    { ...session, moduleAccess: user?.moduleAccess ?? {} },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
