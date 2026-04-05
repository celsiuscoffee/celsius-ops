import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/staff/update
 * Update a staff member (name, email, outlet, role, active status)
 * Body: { staff_id, name?, email?, outlet_id?, outlet_ids?, role?, is_active? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { staff_id, ...updates } = body;

    if (!staff_id) {
      return NextResponse.json(
        { success: false, error: "staff_id is required" },
        { status: 400 }
      );
    }

    // Only allow specific fields to be updated
    const data: Record<string, unknown> = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.email !== undefined) data.email = updates.email;
    if (updates.phone !== undefined) data.phone = updates.phone;
    if (updates.outlet_id !== undefined) data.outletId = updates.outlet_id;
    if (updates.outlet_ids !== undefined) data.outletIds = updates.outlet_ids;
    if (updates.role !== undefined) data.role = updates.role.toUpperCase();
    if (updates.is_active !== undefined) data.status = updates.is_active ? "ACTIVE" : "DEACTIVATED";

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    const staff = await prisma.user.update({
      where: { id: staff_id },
      data,
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
        phone: staff.phone,
        role: staff.role,
        is_active: staff.status === "ACTIVE",
        outlet_id: staff.outletId,
        outlet_ids: staff.outletIds,
        created_at: staff.createdAt,
      },
    });
  } catch (error) {
    console.error("Staff update error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update staff" },
      { status: 500 }
    );
  }
}
