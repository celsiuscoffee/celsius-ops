import { NextResponse } from "next/server";

/**
 * GET /api/staff
 *
 * Returns active staff for the POS context. The Supabase `staff_users`
 * table referenced by older code never existed in the shared loyalty
 * database — staff identity lives in the Prisma `User` table on the
 * inventory schema (which the POS login also queries). We proxy it
 * here so the POS browser doesn't try to query a missing table.
 */
export async function GET() {
  try {
    const { prisma } = await import("@/lib/prisma");
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outletId: true,
      },
      orderBy: { name: "asc" },
    });
    // Shape matches the POS Staff type — brand_id is implicit (Celsius)
    // and is_active is filtered upstream.
    const staff = users.map((u) => ({
      id:           u.id,
      name:         u.name,
      email:        u.email,
      role:         u.role,
      brand_id:     "brand-celsius",
      outlet_id:    u.outletId,
      is_active:    true,
    }));
    return NextResponse.json({ staff });
  } catch (err) {
    console.error("[staff] Error:", err);
    return NextResponse.json({ staff: [] });
  }
}
