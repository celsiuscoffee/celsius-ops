import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const outlets = await prisma.outlet.findMany({
    include: {
      _count: {
        select: { users: true, outletProducts: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = outlets.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    type: b.type,
    status: b.status,
    address: b.address ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    phone: b.phone ?? "",
    staffCount: b._count.users,
    productCount: b._count.outletProducts,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, code, type, phone, address, city, state } = body;

  const outlet = await prisma.outlet.create({
    data: {
      name,
      code,
      type: type || "OUTLET",
      phone: phone || null,
      address: address || "",
      city: city || "",
      state: state || "",
    },
  });

  return NextResponse.json(outlet, { status: 201 });
}
