import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Only allow safe fields
  const { name, code, type, phone, address, city, state, status } = body;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (code !== undefined) data.code = code;
  if (type !== undefined) data.type = type;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  if (city !== undefined) data.city = city;
  if (state !== undefined) data.state = state;
  if (status !== undefined) data.status = status;

  const outlet = await prisma.outlet.update({
    where: { id },
    data,
  });

  const caller = await getUserFromHeaders(req.headers);
  if (caller) {
    await logActivity({
      userId: caller.id,
      action: "update",
      module: "outlets",
      targetId: outlet.id,
      targetName: outlet.name,
      details: status ? `Status changed to ${status}` : `Updated: ${Object.keys(data).join(", ")}`,
    });
  }

  return NextResponse.json(outlet);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Check for linked staff or orders
  const staffCount = await prisma.user.count({ where: { outletId: id } });
  if (staffCount > 0) {
    return NextResponse.json({ error: "Cannot delete outlet with staff assigned. Deactivate instead." }, { status: 400 });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id }, select: { name: true } });

  try {
    await prisma.outlet.delete({ where: { id } });

    const caller = await getUserFromHeaders(req.headers);
    if (caller) {
      await logActivity({
        userId: caller.id,
        action: "delete",
        module: "outlets",
        targetId: id,
        targetName: outlet?.name || id,
        details: "Deleted outlet",
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cannot delete outlet. It may have linked data." }, { status: 400 });
  }
}
