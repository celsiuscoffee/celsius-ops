import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { z } from "zod";

const schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(6, "Password must be at least 6 characters").max(200),
});

export async function POST(req: NextRequest) {
  const caller = getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Validation failed" }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: caller.id },
    select: { passwordHash: true },
  });

  // If user already has a password, verify current password
  if (user?.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
  }

  const hashed = hashPassword(newPassword);
  await prisma.user.update({
    where: { id: caller.id },
    data: { passwordHash: hashed },
  });

  return NextResponse.json({ ok: true });
}
