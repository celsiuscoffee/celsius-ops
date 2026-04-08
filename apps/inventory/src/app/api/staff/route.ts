import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders, requireRole, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { hashPin } from "@celsius/auth";
import { logActivity } from "@/lib/activity-log";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const caller = getUserFromHeaders(req.headers);

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
  const skip = (page - 1) * limit;

  // Managers can only see users in their outlet
  const where: Record<string, unknown> = {};
  if (caller?.role === "MANAGER" && caller.outletId) {
    where.outletId = caller.outletId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }
  if (status) {
    where.status = status;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { outlet: true },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

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
    permissions: ((u.moduleAccess as Record<string, string[]>)?.["inventory"]) ?? [],
    hasPassword: !!u.passwordHash,
    hasPin: !!u.pin,
    appAccess: u.appAccess ?? [],
    status: u.status,
    addedDate: u.createdAt.toISOString().split("T")[0],
  }));

  return NextResponse.json({ items: mapped, total, page, limit });
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const staffSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    phone: z.string().min(1, "Phone is required").max(20),
    email: z.string().email().optional().nullable(),
    role: z.enum(["OWNER", "ADMIN", "MANAGER", "STAFF"]).optional(),
    outletId: z.string().uuid().optional().nullable(),
    outletIds: z.array(z.string().uuid()).optional(),
    username: z.string().max(100).optional().nullable(),
    password: z.string().min(6).max(200).optional().nullable(),
    pin: z.string().min(4).max(6).optional().nullable(),
    permissions: z.array(z.string()).optional(),
    appAccess: z.array(z.string()).optional(),
  });

  const parsed = staffSchema.safeParse(await req.json());
  if (!parsed.success) {
    const err = parsed.error.issues[0];
    return NextResponse.json({ error: err?.message || "Validation failed", field: err?.path?.join(".") }, { status: 400 });
  }
  const { name, phone, email, role, outletId, outletIds, username, password, pin, permissions, appAccess } = parsed.data;

  const data: Record<string, unknown> = {
    name,
    phone,
    email: email || null,
    role: role || "STAFF",
    outletId: outletId || null,
    outletIds: outletIds || [],
    username: username || null,
    appAccess: appAccess || [],
    moduleAccess: permissions ? { inventory: permissions } : {},
  };

  if (password && password.length >= 6) {
    data.passwordHash = hashPassword(password);
  }
  if (pin) {
    data.pin = await hashPin(pin);
  }

  const caller = getUserFromHeaders(req.headers);
  const user = await prisma.user.create({ data: data as never });

  if (caller) {
    await logActivity({
      userId: caller.id,
      action: "create",
      module: "staff",
      targetId: user.id,
      targetName: name,
      details: `Added staff member (${role || "STAFF"})`,
    });
  }

  return NextResponse.json(user, { status: 201 });
}
