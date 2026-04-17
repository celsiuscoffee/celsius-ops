import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: list all employees with their HR profiles
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all active users from Prisma (incl. login fields)
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, role: true, phone: true, email: true,
      outletId: true, outlet: { select: { name: true } },
      username: true, appAccess: true, moduleAccess: true, status: true,
      pin: true, passwordHash: true, lastLoginAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  // Get all HR profiles from Supabase
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*");

  const profileMap = new Map((profiles || []).map((p: { user_id: string }) => [p.user_id, p]));

  const employees = users.map((u) => {
    const { pin, passwordHash, ...rest } = u;
    return {
      ...rest,
      hasPin: !!pin,
      hasPassword: !!passwordHash,
      hrProfile: profileMap.get(u.id) || null,
    };
  });

  return NextResponse.json({ employees });
}

// POST: create or update an HR profile for an employee
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, ...profileData } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Upsert: check if profile exists
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("id")
    .eq("user_id", user_id)
    .maybeSingle();

  if (existing) {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ ...profileData, updated_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  } else {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .insert({ user_id, ...profileData })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  }
}
