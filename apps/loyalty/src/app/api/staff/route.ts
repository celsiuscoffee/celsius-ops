import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// GET /api/staff — fetch staff users (requires admin auth, NEVER returns PINs)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outlet_id");

    const where: Record<string, unknown> = { role: "STAFF" };
    if (outletId) {
      where.OR = [
        { outletId: outletId },
        { outletIds: { has: outletId } },
      ];
    }

    const staffList = await prisma.user.findMany({
      where,
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
      orderBy: { name: "asc" },
    });

    // Map to match the shape the frontend expects
    const mapped = staffList.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      role: s.role,
      is_active: s.status === "ACTIVE",
      outlet_id: s.outletId,
      outlet_ids: s.outletIds,
      created_at: s.createdAt,
    }));

    return NextResponse.json(mapped);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/staff — soft-delete a staff user (requires admin auth)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id },
      data: { status: "DEACTIVATED" },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
