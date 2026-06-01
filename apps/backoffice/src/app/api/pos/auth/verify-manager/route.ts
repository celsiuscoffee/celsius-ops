/**
 * Manager-PIN verification used by the POS to gate elevated actions
 * (void line, override price, refund, etc.).
 *
 * Reads from the canonical Prisma `User` table — same source as
 * /api/pos/auth/pin — and bcrypts via the shared `verifyPin` helper
 * so a manager whose stored hash uses bcryptjs vs bcrypt still passes.
 *
 * Supabase client is lazy-initialized inside the handler so this
 * module compiles cleanly during Vercel's collect-page-data phase
 * (env vars aren't available there).
 */
import { NextResponse, NextRequest } from "next/server";
import { verifyPin } from "@/lib/pos-auth";

export async function POST(req: NextRequest) {
  try {
    const { pin } = await req.json();
    if (!pin || pin.length < 4) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 });
    }

    const { prisma } = await import("@/lib/prisma");
    const managers = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        pin: { not: null },
        role: { in: ["MANAGER", "OWNER", "ADMIN"] },
      },
      select: { id: true, name: true, pin: true },
    });

    for (const user of managers) {
      if (!user.pin) continue;
      const { match } = await verifyPin(pin, user.pin);
      if (match) return NextResponse.json({ ok: true, name: user.name });
    }
    return NextResponse.json({ error: "Invalid manager PIN" }, { status: 401 });
  } catch (err) {
    console.error("[verify-manager] error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
