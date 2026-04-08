import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, hashPin } from "@/lib/auth";

// POST /api/staff/create — create a new staff member (requires admin auth)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { name, email, phone, outlet_id, outlet_ids, role, pin } = body;

    if (!name || !pin) {
      return NextResponse.json(
        { success: false, error: "name and pin are required" },
        { status: 400 }
      );
    }

    // Hash PIN before storing
    const hashedPin = await hashPin(pin);

    const resolvedOutletIds = outlet_ids || (outlet_id ? [outlet_id] : []);

    const staff = await prisma.user.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        role: "STAFF",
        pin: hashedPin,
        status: "ACTIVE",
        outletId: resolvedOutletIds[0] || null,
        outletIds: resolvedOutletIds,
        appAccess: ["loyalty"],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        outletId: true,
        outletIds: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      staff: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        is_active: staff.status === "ACTIVE",
        outlet_id: staff.outletId,
        outlet_ids: staff.outletIds,
        created_at: staff.createdAt,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to create staff" },
      { status: 500 }
    );
  }
}
