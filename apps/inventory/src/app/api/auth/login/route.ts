import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterMs } = checkRateLimit(`login:${ip}`, 5, 60_000);
  if (limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: {
      username: username.trim(),
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "MANAGER"] },
    },
    include: { outlet: { select: { name: true } } },
  });

  if (!user || !user.password) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  if (!verifyPassword(password, user.password)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
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
