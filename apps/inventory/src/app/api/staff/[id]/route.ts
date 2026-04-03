import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};

  // Basic fields
  if (body.name !== undefined) data.name = body.name;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.role !== undefined) data.role = body.role;
  if (body.branchId !== undefined) data.branchId = body.branchId || null;
  if (body.branchIds !== undefined) data.branchIds = body.branchIds;
  if (body.username !== undefined) data.username = body.username || null;
  if (body.status !== undefined) data.status = body.status;

  // Password — hash before saving
  if (body.password && body.password.length >= 6) {
    data.password = hashPassword(body.password);
  }

  // PIN — store as-is (4 digits)
  if (body.pin !== undefined) {
    data.pin = body.pin || null;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: data as never,
    });
    return NextResponse.json({ ok: true, id: user.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unique constraint")) {
      if (message.includes("phone")) return NextResponse.json({ error: "Phone number already in use" }, { status: 409 });
      if (message.includes("username")) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      if (message.includes("email")) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      return NextResponse.json({ error: "Duplicate value" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update staff" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.user.update({
    where: { id },
    data: { status: "DEACTIVATED" },
  });
  return NextResponse.json({ ok: true });
}
