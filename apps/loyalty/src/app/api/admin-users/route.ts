import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, hashPassword } from "@/lib/auth";

// GET - fetch all admin users (requires auth, excludes password)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const users = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "MANAGER"] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      outletId: true,
      outletIds: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  // Map to match the shape the frontend expects
  const mapped = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    is_active: u.status === "ACTIVE",
    outlets: u.outletIds || [],
    last_login_at: u.lastLoginAt,
    created_at: u.createdAt,
  }));

  return NextResponse.json(mapped);
}

// POST - create admin user (requires auth + OWNER/ADMIN role)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== "ADMIN" && auth.user.role !== "OWNER") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password, role, is_active, outlets } = body;
  if (!name || !email || !password)
    return NextResponse.json({ error: "name, email, password required" }, { status: 400 });

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const hashedPassword = await hashPassword(password);

  // Map role to Prisma enum (uppercase)
  const prismaRole = (role || "MANAGER").toUpperCase();

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: hashedPassword,
        role: prismaRole,
        status: is_active !== false ? "ACTIVE" : "DEACTIVATED",
        outletIds: outlets || [],
        outletId: outlets?.[0] || null,
        appAccess: ["loyalty"],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        outletIds: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.status === "ACTIVE",
      outlets: user.outletIds || [],
      created_at: user.createdAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT - update admin user (requires auth + OWNER/ADMIN role)
export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== "ADMIN" && auth.user.role !== "OWNER") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const body = await request.json();
  const { id, name, email, password, role, is_active, outlets } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (password !== undefined) updates.passwordHash = await hashPassword(password);
  if (role !== undefined) updates.role = role.toUpperCase();
  if (is_active !== undefined) updates.status = is_active ? "ACTIVE" : "DEACTIVATED";
  if (outlets !== undefined) {
    updates.outletIds = outlets;
    updates.outletId = outlets[0] || null;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        outletIds: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.status === "ACTIVE",
      outlets: user.outletIds || [],
      last_login_at: user.lastLoginAt,
      created_at: user.createdAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - soft-delete admin user (requires auth + OWNER/ADMIN role)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== "ADMIN" && auth.user.role !== "OWNER") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await prisma.user.update({
      where: { id },
      data: { status: "DEACTIVATED" },
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
