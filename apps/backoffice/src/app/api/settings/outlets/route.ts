import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { OutletStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as OutletStatus | null;

  const where = status ? { status } : {};

  const outlets = await prisma.outlet.findMany({
    where,
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
    lat: b.lat ? Number(b.lat) : null,
    lng: b.lng ? Number(b.lng) : null,
    openTime: b.openTime ?? "08:00",
    closeTime: b.closeTime ?? "22:00",
    daysOpen: b.daysOpen ?? [1, 2, 3, 4, 5, 6, 7],
    isOpen: b.isOpen,
    isBusy: b.isBusy,
    pickupTimeMins: b.pickupTimeMins,
    storehubId: b.storehubId ?? "",
    loyaltyOutletId: b.loyaltyOutletId ?? "",
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
