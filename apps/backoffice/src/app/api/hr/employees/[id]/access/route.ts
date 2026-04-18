import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPin, hashPassword } from "@celsius/auth";

export const dynamic = "force-dynamic";

// PATCH: update a user's login access (role, appAccess, moduleAccess, username, pin, password, status, outlet)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  // Build update data from provided fields
  const updateData: Record<string, unknown> = {};

  if (body.role !== undefined) updateData.role = body.role;
  if (body.username !== undefined) updateData.username = body.username || null;
  if (body.email !== undefined) updateData.email = body.email || null;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.outletId !== undefined) updateData.outletId = body.outletId || null;
  if (body.outletIds !== undefined) updateData.outletIds = body.outletIds;
  if (body.appAccess !== undefined) updateData.appAccess = body.appAccess;
  if (body.moduleAccess !== undefined) updateData.moduleAccess = body.moduleAccess;
  if (body.fullName !== undefined) updateData.fullName = body.fullName || null;
  if (body.bankName !== undefined) updateData.bankName = body.bankName || null;
  if (body.bankAccountNumber !== undefined) updateData.bankAccountNumber = body.bankAccountNumber || null;
  if (body.bankAccountName !== undefined) updateData.bankAccountName = body.bankAccountName || null;

  // Hash PIN if provided
  if (body.pin !== undefined) {
    if (body.pin === null || body.pin === "") {
      updateData.pin = null;
    } else if (body.pin.length >= 4 && body.pin.length <= 6 && /^\d+$/.test(body.pin)) {
      updateData.pin = await hashPin(body.pin);
    } else {
      return NextResponse.json({ error: "PIN must be 4-6 digits" }, { status: 400 });
    }
  }

  // Hash password if provided
  if (body.password !== undefined) {
    if (body.password === null || body.password === "") {
      updateData.passwordHash = null;
    } else if (body.password.length >= 8) {
      updateData.passwordHash = await hashPassword(body.password);
    } else {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, role: true, username: true, status: true,
        appAccess: true, moduleAccess: true, outletId: true,
      },
    });
    return NextResponse.json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
