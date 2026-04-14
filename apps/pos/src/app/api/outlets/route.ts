import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { prisma } = await import("@/lib/prisma");
    const outlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ outlets });
  } catch (err) {
    console.error("[outlets] Error:", err);
    return NextResponse.json({ outlets: [] });
  }
}
