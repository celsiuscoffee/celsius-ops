import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { generateConfirmationLetterPDF } from "@/lib/hr/statutory/confirmation-letter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/hr/employees/[id]/confirmation-letter — generate the PDF on demand.
// Used both as a download from the probation banner and for HR to send the
// signed copy back into the employee Documents vault.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const [user, profileRes, companyRes] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { id: true, name: true, fullName: true } }),
    hrSupabaseAdmin.from("hr_employee_profiles").select("*").eq("user_id", id).single(),
    hrSupabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle(),
  ]);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const profile = profileRes.data as {
    ic_number?: string | null; position?: string | null; join_date?: string | null;
    basic_salary?: number | string | null; probation_end_date?: string | null;
  } | null;
  if (!profile) return NextResponse.json({ error: "HR profile not found" }, { status: 404 });
  if (!profile.join_date) return NextResponse.json({ error: "Cannot issue confirmation without a join_date" }, { status: 400 });

  const company = companyRes.data as {
    company_name?: string; ssm_number?: string | null;
    address_line1?: string | null; address_line2?: string | null;
    postcode?: string | null; city?: string | null; country?: string | null;
    confirmation_signatory_name?: string | null; confirmation_signatory_title?: string | null;
  } | null;

  // Effective confirmation date: explicit probation_end_date OR join_date + 90d.
  const effectiveEnd = profile.probation_end_date
    ?? new Date(Date.parse(profile.join_date) + 90 * 86400000).toISOString().slice(0, 10);

  const pdf = await generateConfirmationLetterPDF({
    employeeFullName: user.fullName || user.name,
    icNumber: profile.ic_number ?? null,
    position: profile.position || "Employee",
    joinDate: profile.join_date,
    confirmationDate: effectiveEnd,
    basicSalary: Number(profile.basic_salary || 0),
    noticePeriod: "two (2) calendar months",
    companyName: company?.company_name || "Celsius Coffee Sdn. Bhd.",
    companySSM: company?.ssm_number || null,
    companyAddress: [company?.address_line1, company?.address_line2, company?.postcode, company?.city, company?.country]
      .filter(Boolean).join(", ") || null,
    signatoryName: company?.confirmation_signatory_name || "Ammar Bin Shahrin",
    signatoryTitle: company?.confirmation_signatory_title || "Chief Executive Officer",
  });

  const filename = `Confirmation_Letter_${(user.fullName || user.name).replace(/\s+/g, "_")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
