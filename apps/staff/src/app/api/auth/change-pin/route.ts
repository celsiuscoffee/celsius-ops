import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPin, verifyPin } from "@celsius/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/change-pin
// Body: { current_pin: string, new_pin: string }
// Validates current PIN, then updates to hashed new PIN.
// PIN must be 4-6 digits.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const currentPin = (body.current_pin || "").trim();
  const newPin = (body.new_pin || "").trim();

  if (!/^\d{4,6}$/.test(newPin)) {
    return NextResponse.json({ error: "New PIN must be 4-6 digits" }, { status: 400 });
  }
  if (currentPin === newPin) {
    return NextResponse.json({ error: "New PIN must differ from current PIN" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, pin: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!user.pin) {
    // No PIN set yet — allow setting one without current_pin if not provided.
    // If current_pin is provided, reject since there's nothing to verify against.
    if (currentPin) return NextResponse.json({ error: "No PIN currently set" }, { status: 400 });
  } else {
    // Verify current PIN
    const { match } = await verifyPin(currentPin, user.pin);
    if (!match) return NextResponse.json({ error: "Current PIN is incorrect" }, { status: 401 });
  }

  const hashed = await hashPin(newPin);
  await prisma.user.update({
    where: { id: session.id },
    data: { pin: hashed, updatedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
