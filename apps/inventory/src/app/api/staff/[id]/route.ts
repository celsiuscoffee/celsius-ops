import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, getUserFromHeaders, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { hashPin } from "@celsius/auth";
import { logActivity } from "@/lib/activity-log";

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
  if (body.outletId !== undefined) data.outletId = body.outletId || null;
  if (body.outletIds !== undefined) data.outletIds = body.outletIds;
  if (body.username !== undefined) data.username = body.username || null;
  if (body.status !== undefined) data.status = body.status;
  // Store module permissions in moduleAccess JSON
  if (body.permissions !== undefined) {
    // Read existing moduleAccess, update inventory key
    const existing = await prisma.user.findUnique({ where: { id }, select: { moduleAccess: true } });
    const moduleAccess = (existing?.moduleAccess as Record<string, string[]>) ?? {};
    moduleAccess["inventory"] = body.permissions;
    data.moduleAccess = moduleAccess;
  }

  // Password — hash before saving
  if (body.password && body.password.length >= 6) {
    data.passwordHash = hashPassword(body.password);
  }

  // PIN — hash with bcrypt before saving
  if (body.pin !== undefined) {
    data.pin = body.pin ? await hashPin(body.pin) : null;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: data as never,
      select: { id: true, name: true },
    });

    const caller = getUserFromHeaders(req.headers);
    if (caller) {
      const changes = Object.keys(data).filter((k) => k !== "password" && k !== "pin").join(", ");
      await logActivity({
        userId: caller.id,
        action: "update",
        module: "staff",
        targetId: user.id,
        targetName: user.name,
        details: `Updated: ${changes || "credentials"}`,
      });
    }

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await prisma.user.update({
    where: { id },
    data: { status: "DEACTIVATED" },
    select: { id: true, name: true },
  });

  const caller = getUserFromHeaders(req.headers);
  if (caller) {
    await logActivity({
      userId: caller.id,
      action: "update",
      module: "staff",
      targetId: user.id,
      targetName: user.name,
      details: "Deactivated staff member",
    });
  }

  return NextResponse.json({ ok: true });
}
