import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPin, hashPin } from "@celsius/auth";

export async function POST(req: NextRequest) {
  const { pin } = await req.json();

  if (!pin || pin.length < 4) {
    return NextResponse.json(
      { error: "PIN required (minimum 4 digits)" },
      { status: 400 },
    );
  }

  // Find all active staff with a PIN set
  const candidates = await prisma.user.findMany({
    where: {
      pin: { not: null },
      role: "STAFF",
      status: "ACTIVE",
    },
    include: { outlet: { select: { name: true } } },
  });

  // Check PIN against each candidate (bcrypt or plaintext with progressive rehash)
  for (const user of candidates) {
    const { match, needsRehash } = await verifyPin(pin, user.pin);
    if (!match) continue;

    // Progressive migration: rehash plaintext PINs to bcrypt
    if (needsRehash) {
      const hashed = await hashPin(pin);
      await prisma.user.update({
        where: { id: user.id },
        data: { pin: hashed },
      });
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

  return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
}
