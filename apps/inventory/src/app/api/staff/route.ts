import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const users = await prisma.user.findMany({
    include: {
      branch: true,
    },
    orderBy: { name: "asc" },
  });

  const mapped = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    branch: u.branch?.name ?? "",
    branchId: u.branchId,
    branchCode: u.branch?.code ?? "",
    phone: u.phone ?? "",
    email: u.email,
    status: u.status,
    addedDate: u.createdAt.toISOString().split("T")[0],
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, phone, email, role, branchId } = body;

  const user = await prisma.user.create({
    data: {
      name,
      phone,
      email: email || null,
      role: role || "STAFF",
      branchId: branchId || null,
    },
  });

  return NextResponse.json(user, { status: 201 });
}
