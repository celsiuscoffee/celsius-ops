import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterMs } = await checkRateLimit(`login:${ip}`, 5, 60_000);
  if (limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json();
  // Accept either { identifier } (new) or { username } (back-compat).
  const identifierRaw: string = (body.identifier ?? body.username ?? "").toString().trim();
  const password: string = body.password ?? "";

  if (!identifierRaw || !password) {
    return NextResponse.json({ error: "Email/username and password required" }, { status: 400 });
  }

  const isEmail = identifierRaw.includes("@");
  const user = await prisma.user.findFirst({
    where: {
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "MANAGER"] },
      ...(isEmail
        ? { email: { equals: identifierRaw, mode: "insensitive" } }
        : { username: identifierRaw }),
    },
    include: { outlet: { select: { name: true } } },
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
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
