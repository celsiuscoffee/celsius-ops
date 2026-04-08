import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[staff PATCH] Auth error:', e);
    return NextResponse.json({ error: 'Auth error' }, { status: 500 });
  }

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error('[staff PATCH] Body parse error:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

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
  if (body.appAccess !== undefined) data.appAccess = body.appAccess;
  if (body.moduleAccess !== undefined) data.moduleAccess = body.moduleAccess;

  // Password — hash before saving
  if (body.password && body.password.length >= 8) {
    data.password = hashPassword(body.password);
  }

  // PIN — store as-is (4 or 6 digits)
  if (body.pin !== undefined) {
    data.pin = body.pin || null;
  }

  try {
    // Ensure moduleAccess is valid JSON for Prisma
    if (data.moduleAccess !== undefined && typeof data.moduleAccess === 'object') {
      data.moduleAccess = JSON.parse(JSON.stringify(data.moduleAccess));
    }

    const user = await prisma.user.update({
      where: { id },
      data: data as never,
    });
    return NextResponse.json({ ok: true, id: user.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('[staff PATCH] Error updating', id, ':', message, stack);
    const safeData = { ...data };
    delete safeData.password;
    delete safeData.pin;
    console.error('[staff PATCH] Data was:', JSON.stringify(safeData));
    if (message.includes("Unique constraint")) {
      if (message.includes("phone")) return NextResponse.json({ error: "Phone number already in use" }, { status: 409 });
      if (message.includes("username")) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      if (message.includes("email")) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      return NextResponse.json({ error: "Duplicate value" }, { status: 409 });
    }
    return NextResponse.json({ error: `Failed to update: ${message}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const { id } = await params;
  await prisma.user.update({
    where: { id },
    data: { status: "DEACTIVATED" },
  });
  return NextResponse.json({ ok: true });
}
