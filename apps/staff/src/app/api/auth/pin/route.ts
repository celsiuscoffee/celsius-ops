import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { pin } = await req.json();

  if (!pin || pin.length < 6) {
    return NextResponse.json(
      { error: "PIN required (6 digits)" },
      { status: 400 },
    );
  }

  const users = await prisma.user.findMany({
    where: {
      pin: pin.trim(),
      status: "ACTIVE",
    },
    include: { outlet: { select: { name: true } } },
  });

  const user = users[0];

  if (!user) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  await createSession({
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: user.outletId,
    outletName: user.outlet?.name ?? null,
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    role: user.role,
  });
}
