import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { hashPin } from "@celsius/auth";

export const dynamic = "force-dynamic";

// POST /api/hr/employees/create — create a new User + hr_employee_profiles row in one call
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    name, fullName, phone, email, role, outletId,
    position, employment_type, join_date, basic_salary, hourly_rate,
    ic_number, date_of_birth, gender, pin,
  } = body;

  if (!name || !role) {
    return NextResponse.json({ error: "name and role are required" }, { status: 400 });
  }

  // Phone is optional now — contract staff / HR-only records don't need one.
  // Only check uniqueness when a phone was provided.
  const phoneValue = (phone || "").trim() || null;
  if (phoneValue) {
    const existing = await prisma.user.findUnique({ where: { phone: phoneValue } });
    if (existing) {
      return NextResponse.json({ error: `Phone ${phoneValue} is already registered` }, { status: 409 });
    }
  }

  try {
    const user = await prisma.user.create({
      data: {
        name,
        fullName: fullName || null,
        phone: phoneValue,
        email: email || null,
        role,
        outletId: outletId || null,
        status: "ACTIVE",
        appAccess: [],
        moduleAccess: {},
        pin: pin ? await hashPin(pin) : null,
      },
      select: { id: true, name: true, role: true, outletId: true },
    });

    // Create matching hr_employee_profiles row
    const { error: profileError } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .insert({
        user_id: user.id,
        position: position || null,
        employment_type: employment_type || "full_time",
        join_date: join_date || new Date().toISOString().slice(0, 10),
        basic_salary: basic_salary ? Number(basic_salary) : 0,
        hourly_rate: hourly_rate ? Number(hourly_rate) : null,
        ic_number: ic_number || null,
        date_of_birth: date_of_birth || null,
        gender: gender || null,
        nationality: "Malaysian",
      });

    if (profileError) {
      console.error("[create-employee] profile error:", profileError.message);
      // User row was created; return partial success
      return NextResponse.json({
        user,
        warning: `User created but profile failed: ${profileError.message}`,
      }, { status: 207 });
    }

    // Backfill initial salary/job history rows
    await hrSupabaseAdmin.from("hr_salary_history").insert({
      user_id: user.id,
      effective_date: join_date || new Date().toISOString().slice(0, 10),
      salary_type: employment_type === "part_time" ? "hourly" : "monthly",
      amount: employment_type === "part_time" ? Number(hourly_rate || 0) : Number(basic_salary || 0),
      comment: "Initial salary on hire",
      created_by: session.id,
    });
    await hrSupabaseAdmin.from("hr_job_history").insert({
      user_id: user.id,
      effective_date: join_date || new Date().toISOString().slice(0, 10),
      job_title: position || role,
      outlet_id: outletId || null,
      employment_type: employment_type || "full_time",
      note: "Initial hire",
      created_by: session.id,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create employee";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
