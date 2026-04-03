import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders, requireRole, AuthError } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function GET(req: NextRequest) {
  const caller = getUserFromHeaders(req.headers);

  // Branch managers can only see users in their branch
  const where = caller?.role === "BRANCH_MANAGER" && caller.branchId
    ? { branchId: caller.branchId }
    : {};

  const users = await prisma.user.findMany({
    where,
    include: { branch: true },
    orderBy: { name: "asc" },
  });

  // Resolve branch names for branchIds
  const allBranchIds = [...new Set(users.flatMap((u) => u.branchIds).filter(Boolean))];
  const branchMap = new Map<string, string>();
  if (allBranchIds.length > 0) {
    const branches = await prisma.branch.findMany({
      where: { id: { in: allBranchIds } },
      select: { id: true, name: true },
    });
    branches.forEach((b) => branchMap.set(b.id, b.name));
  }

  const mapped = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    branch: u.branch?.name ?? "",
    branchId: u.branchId,
    branchCode: u.branch?.code ?? "",
    branchIds: u.branchIds,
    branchNames: u.branchIds.map((id) => branchMap.get(id) ?? id),
    phone: u.phone ?? "",
    email: u.email,
    username: u.username,
    hasPassword: !!u.password,
    hasPin: !!u.pin,
    status: u.status,
    addedDate: u.createdAt.toISOString().split("T")[0],
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  try {
    requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const body = await req.json();
  const { name, phone, email, role, branchId, branchIds, username, password, pin } = body;

  const data: Record<string, unknown> = {
    name,
    phone,
    email: email || null,
    role: role || "STAFF",
    branchId: branchId || null,
    branchIds: branchIds || [],
    username: username || null,
  };

  if (password && password.length >= 6) {
    data.password = hashPassword(password);
  }
  if (pin) {
    data.pin = pin;
  }

  const user = await prisma.user.create({ data: data as never });
  return NextResponse.json(user, { status: 201 });
}
