import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1).max(100).trim(),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = loginSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const { username, password } = body;

  const user = await prisma.user.findFirst({
    where: {
      username,
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "MANAGER"] },
    },
    include: { outlet: { select: { name: true } } },
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
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
