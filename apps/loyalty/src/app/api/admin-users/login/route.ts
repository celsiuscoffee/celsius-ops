import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// POST - verify email + password, return session cookie
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Rate limit by email
    const rateCheck = await checkRateLimit(email, RATE_LIMITS.ADMIN_LOGIN);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${rateCheck.retryAfter} seconds.` },
        { status: 429 }
      );
    }

    // Fetch active admin/manager/owner user
    const user = await prisma.user.findFirst({
      where: {
        email,
        status: "ACTIVE",
        role: { in: ["OWNER", "ADMIN", "MANAGER"] },
      },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Verify password (supports both scrypt and bcrypt via @celsius/auth)
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create session (sets celsius-session httpOnly cookie)
    await createSession({
      id: user.id,
      name: user.name,
      role: user.role as "OWNER" | "ADMIN" | "MANAGER",
      outletId: user.outletId || null,
    });

    // Return user data
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        outlets: user.outletIds || [],
      },
    });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
