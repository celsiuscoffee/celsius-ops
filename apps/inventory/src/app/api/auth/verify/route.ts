import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";

const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json();

  if (!phone || !code) {
    return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
  }

  const normalized = phone.replace(/[\s-]/g, "");

  // Find the most recent unused OTP for this phone
  const otp = await prisma.otp.findFirst({
    where: { phone: normalized, verified: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    return NextResponse.json({ error: "No pending code. Please request a new one." }, { status: 400 });
  }

  // Check expiry
  if (otp.expiresAt < new Date()) {
    await prisma.otp.update({ where: { id: otp.id }, data: { verified: true } });
    return NextResponse.json({ error: "Code expired. Please request a new one." }, { status: 410 });
  }

  // Check attempts (brute-force protection)
  if (otp.attempts >= MAX_ATTEMPTS) {
    await prisma.otp.update({ where: { id: otp.id }, data: { verified: true } });
    return NextResponse.json({ error: "Too many attempts. Please request a new code." }, { status: 429 });
  }

  // Verify code
  if (otp.code !== code.trim()) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = MAX_ATTEMPTS - otp.attempts - 1;
    return NextResponse.json(
      { error: `Invalid code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` },
      { status: 401 },
    );
  }

  // OTP is valid — mark as used
  await prisma.otp.update({ where: { id: otp.id }, data: { verified: true } });

  // Find user and create session
  const user = await prisma.user.findFirst({
    where: { phone: normalized, status: "ACTIVE" },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  await createSession({
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: user.outletId,
  });

  await logActivity({
    userId: user.id,
    action: "login",
    module: "auth",
    details: `Logged in via OTP`,
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    role: user.role,
  });
}
