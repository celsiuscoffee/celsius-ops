import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { HireError, hireEmployee, ROLES } from "@/lib/hr/hire";

export const dynamic = "force-dynamic";

const STATUS_FOR: Record<HireError["code"], number> = {
  invalid: 400,
  duplicate: 409,
  pin_taken: 409,
};

// POST /api/hr/employees/create — create a new User + hr_employee_profiles row
// in one call. All the provisioning lives in lib/hr/hire, shared with the LoE
// import and the HR agent, so the three cannot drift apart again.
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
    performance_allowance_amount, attendance_allowance_amount,
    epf_number, bankName, bankAccountNumber, bankAccountName,
  } = body;

  if (!name || !role) {
    return NextResponse.json({ error: "name and role are required" }, { status: 400 });
  }
  // Privilege-escalation guard (2026-09-03 QA): this route took `role` from
  // the body unchecked, so an ADMIN could create an OWNER account and log in
  // as it. The OWNER role is OWNER-only to grant, same as [id]/access.
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role: ${String(role)}` }, { status: 400 });
  }
  if (role === "OWNER" && session.role !== "OWNER") {
    return NextResponse.json({ error: "Only an OWNER can create an OWNER account" }, { status: 403 });
  }

  try {
    const { userId } = await hireEmployee({
      name,
      fullName,
      phone,
      email,
      role,
      outletId,
      position,
      employmentType: employment_type,
      joinDate: join_date,
      basicSalary: basic_salary,
      hourlyRate: hourly_rate,
      performanceAllowance: performance_allowance_amount,
      attendanceAllowance: attendance_allowance_amount,
      icNumber: ic_number,
      dateOfBirth: date_of_birth,
      gender,
      epfNumber: epf_number,
      bankName,
      bankAccountNumber,
      bankAccountName,
      pin,
      createdBy: session.id,
    });

    return NextResponse.json(
      { user: { id: userId, name, role, outletId: outletId || null } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof HireError) {
      return NextResponse.json({ error: err.message }, { status: STATUS_FOR[err.code] });
    }
    const message = err instanceof Error ? err.message : "Failed to create employee";
    console.error("[create-employee]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
