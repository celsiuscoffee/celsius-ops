/**
 * Manager-PIN verification used by the POS to gate elevated actions
 * (void line, override price, refund, etc.).
 *
 * Reads from the canonical Prisma `User` table — same source as
 * /api/pos/auth/pin — and bcrypts via the shared `verifyPin` helper
 * so a manager whose stored hash uses bcryptjs vs bcrypt still passes.
 *
 * Two guards, both added 2026-09-25 after the security review found this
 * route open to an online brute force of every manager PIN in the org:
 *   1. The caller must already hold a POS cashier session (Bearer from the
 *      till, cookie from the web register) — a manager override only ever
 *      happens mid-shift on a signed-in register.
 *   2. Per-IP and per-cashier throttle, 10 attempts / 5 min.
 *
 * Supabase client is lazy-initialized inside the handler so this
 * module compiles cleanly during Vercel's collect-page-data phase
 * (env vars aren't available there).
 */
import { NextResponse, NextRequest } from "next/server";
import { verifyPin, getPosUser } from "@/lib/pos-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const cashier = await getPosUser(req);
    if (!cashier) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    for (const key of [`verify-manager:ip:${ip}`, `verify-manager:user:${cashier.id}`]) {
      const { limited, retryAfterMs } = await checkRateLimit(key, 10, 300_000);
      if (limited) {
        return NextResponse.json(
          { error: "Too many PIN attempts. Please try again later." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
        );
      }
    }

    const { pin } = await req.json();
    // PINs are exactly 6 digits (owner ruling 2026-08-19; /api/pos/auth/pin
    // enforces the same floor).
    if (typeof pin !== "string" || pin.length < 6) {
      return NextResponse.json({ error: "PIN required (6 digits)" }, { status: 400 });
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
