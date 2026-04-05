import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export async function POST(req: NextRequest) {
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
