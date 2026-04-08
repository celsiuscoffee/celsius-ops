import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders, requireRole, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);

  // Managers can only see users in their outlet
  const where = caller?.role === "MANAGER" && caller.outletId
    ? { outletId: caller.outletId }
    : {};

  const users = await prisma.user.findMany({
    where,
    include: { outlet: true },
    orderBy: { name: "asc" },
  });

  // Resolve outlet names for outletIds
  const allOutletIds = [...new Set(users.flatMap((u) => u.outletIds).filter(Boolean))];
  const outletMap = new Map<string, string>();
  if (allOutletIds.length > 0) {
    const outlets = await prisma.outlet.findMany({
      where: { id: { in: allOutletIds } },
      select: { id: true, name: true },
    });
    outlets.forEach((b) => outletMap.set(b.id, b.name));
  }

  const mapped = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    outlet: u.outlet?.name ?? "",
    outletId: u.outletId,
    outletCode: u.outlet?.code ?? "",
    outletIds: u.outletIds,
    outletNames: u.outletIds.map((id) => outletMap.get(id) ?? id),
    phone: u.phone ?? "",
    email: u.email,
    username: u.username,
    hasPassword: !!u.passwordHash,
    hasPin: !!u.pin,
    status: u.status,
    addedDate: u.createdAt.toISOString().split("T")[0],
    appAccess: u.appAccess || [],
    moduleAccess: u.moduleAccess || {},
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const body = await req.json();
  const { name, phone, email, role, outletId, outletIds, username, password, pin, appAccess, moduleAccess } = body;

  const data: Record<string, unknown> = {
    name,
    phone,
    email: email || null,
    role: role || "STAFF",
    outletId: outletId || null,
    outletIds: outletIds || [],
    username: username || null,
    appAccess: appAccess || [],
    moduleAccess: moduleAccess || {},
  };

  if (password && password.length >= 8) {
    data.passwordHash = hashPassword(password);
  }
  if (pin) {
    data.pin = pin;
  }

  const user = await prisma.user.create({ data: data as never });
  return NextResponse.json({ id: user.id, name: user.name, role: user.role }, { status: 201 });
}
