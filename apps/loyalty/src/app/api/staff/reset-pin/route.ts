import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, hashPin } from "@/lib/auth";

// POST /api/staff/reset-pin — reset a staff member's PIN (requires admin auth)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { staff_id, new_pin } = await request.json();

    if (!staff_id) {
      return NextResponse.json(
        { success: false, error: "staff_id is required" },
        { status: 400 }
      );
    }

    // Generate random 6-digit PIN if not provided
    const pin = new_pin || String(randomInt(100000, 1000000));

    // Hash PIN before storing
    const hashedPin = await hashPin(pin);

    await prisma.user.update({
      where: { id: staff_id },
      data: { pin: hashedPin },
    });

    return NextResponse.json({
      success: true,
      pin, // Return the new PIN so it can be shown briefly to admin
      message: "PIN reset successfully",
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to reset PIN" },
      { status: 500 }
    );
  }
}
