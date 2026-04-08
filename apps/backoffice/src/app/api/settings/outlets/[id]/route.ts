import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Only allow safe fields
  const {
    name, code, type, phone, address, city, state, status,
    openTime, closeTime, daysOpen, isOpen, isBusy, pickupTimeMins,
    storehubId, loyaltyOutletId, lat, lng,
  } = body;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (code !== undefined) data.code = code;
  if (type !== undefined) data.type = type;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  if (city !== undefined) data.city = city;
  if (state !== undefined) data.state = state;
  if (status !== undefined) data.status = status;
  if (openTime !== undefined) data.openTime = openTime;
  if (closeTime !== undefined) data.closeTime = closeTime;
  if (daysOpen !== undefined) data.daysOpen = daysOpen;
  if (isOpen !== undefined) data.isOpen = isOpen;
  if (isBusy !== undefined) data.isBusy = isBusy;
  if (pickupTimeMins !== undefined) data.pickupTimeMins = pickupTimeMins;
  if (storehubId !== undefined) data.storehubId = storehubId || null;
  if (loyaltyOutletId !== undefined) data.loyaltyOutletId = loyaltyOutletId || null;
  if (lat !== undefined) data.lat = lat;
  if (lng !== undefined) data.lng = lng;

  const outlet = await prisma.outlet.update({
    where: { id },
    data,
  });

  return NextResponse.json(outlet);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Check for linked staff or orders
  const staffCount = await prisma.user.count({ where: { outletId: id } });
  if (staffCount > 0) {
    return NextResponse.json({ error: "Cannot delete outlet with staff assigned. Deactivate instead." }, { status: 400 });
  }

  try {
    await prisma.outlet.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cannot delete outlet. It may have linked data." }, { status: 400 });
  }
}
