import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staff = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, role: true, outletId: true, outlet: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(staff);
}
