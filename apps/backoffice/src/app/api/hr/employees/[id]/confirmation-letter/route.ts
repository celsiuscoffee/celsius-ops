import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { generateConfirmationLetterPDF, type ConfirmationLetterData } from "@/lib/hr/statutory/confirmation-letter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = "hr-documents";
const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

type AnyClient = ReturnType<typeof createClient>;
function storageClient(): AnyClient {
  return createClient(supabaseUrl, supabaseKey);
}

// Build the data payload + (optionally) fetch the signature bytes. Shared by
// GET (preview download) and POST (sign-and-file).
async function loadLetterData(
  userId: string,
  withSignature: boolean,
): Promise<
  | { ok: true; data: ConfirmationLetterData; employeeName: string }
  | { ok: false; status: number; error: string }
> {
  const [user, profileRes, companyRes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, fullName: true } }),
    hrSupabaseAdmin.from("hr_employee_profiles").select("*").eq("user_id", userId).single(),
    hrSupabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle(),
  ]);
  if (!user) return { ok: false, status: 404, error: "User not found" };
  const profile = profileRes.data as {
    ic_number?: string | null; position?: string | null; join_date?: string | null;
    basic_salary?: number | string | null; probation_end_date?: string | null;
  } | null;
  if (!profile) return { ok: false, status: 404, error: "HR profile not found" };
  if (!profile.join_date) {
    return { ok: false, status: 400, error: "Cannot issue confirmation without a join_date" };
  }

  const company = companyRes.data as {
    company_name?: string; ssm_number?: string | null;
    address_line1?: string | null; address_line2?: string | null;
    postcode?: string | null; city?: string | null; country?: string | null;
    confirmation_signatory_name?: string | null; confirmation_signatory_title?: string | null;
    confirmation_signature_path?: string | null;
    officer_name?: string | null; officer_position?: string | null;
    officer_email?: string | null; phone?: string | null;
  } | null;

  // Effective confirmation date: explicit probation_end_date OR join_date + 90d.
  const effectiveEnd = profile.probation_end_date
    ?? new Date(Date.parse(profile.join_date) + 90 * 86400000).toISOString().slice(0, 10);

  // Fetch signature bytes from storage when caller actually wants to sign.
  // GET (draft preview) skips this so the letter still shows the dotted line.
  let signatureImageBytes: Uint8Array | null = null;
  if (withSignature && company?.confirmation_signature_path && supabaseUrl && supabaseKey) {
    try {
      const supabase = storageClient();
      const { data: blob } = await supabase.storage.from(BUCKET).download(company.confirmation_signature_path);
      if (blob) signatureImageBytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      // Soft-fail — we still issue an unsigned letter rather than 500ing.
      signatureImageBytes = null;
    }
  }

  const employeeName = user.fullName || user.name;
  const data: ConfirmationLetterData = {
    employeeFullName: employeeName,
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
    companyEmail: company?.officer_email || null,
    companyPhone: company?.phone || null,
    signatoryName: company?.confirmation_signatory_name || company?.officer_name || "Ammar Bin Shahrin",
    signatoryTitle: company?.confirmation_signatory_title || company?.officer_position || "Chief Executive Officer",
    signatureImageBytes,
    signedOnDate: signatureImageBytes ? new Date().toISOString().slice(0, 10) : null,
  };
  return { ok: true, data, employeeName };
}

// GET /api/hr/employees/[id]/confirmation-letter — download an UNSIGNED draft
// PDF. Useful for previewing copy or printing for wet-ink signing.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await loadLetterData(id, false);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const pdf = await generateConfirmationLetterPDF(result.data);
  const filename = `Confirmation_Letter_${result.employeeName.replace(/\s+/g, "_")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// POST /api/hr/employees/[id]/confirmation-letter — sign + file. Stamps the
// company signature onto the PDF and uploads it directly into the employee's
// Documents vault as doc_type="confirmation". Returns the new document row
// so the UI can refresh the list inline.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const { id } = await params;
  const result = await loadLetterData(id, true);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (!result.data.signatureImageBytes) {
    return NextResponse.json(
      {
        error:
          "No company signature on file. Upload one in HR → Settings → Company before signing letters.",
      },
      { status: 400 },
    );
  }

  const pdfBytes = await generateConfirmationLetterPDF(result.data);
  const buffer = Buffer.from(pdfBytes);
  const fileName = `Confirmation_Letter_${result.employeeName.replace(/\s+/g, "_")}_${result.data.confirmationDate}.pdf`;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${id}/confirmation/${stamp}.pdf`;

  const supabase = storageClient();
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: row, error: insErr } = await hrSupabaseAdmin
    .from("hr_employee_documents")
    .insert({
      user_id: id,
      doc_type: "confirmation",
      title: `Confirmation Letter — ${result.data.confirmationDate}`,
      note: `E-signed by ${result.data.signatoryName} on ${result.data.signedOnDate}`,
      effective_date: result.data.confirmationDate,
      file_name: fileName,
      storage_path: storagePath,
      size_bytes: buffer.byteLength,
      mime_type: "application/pdf",
      uploaded_by: session.id,
    })
    .select()
    .single();
  if (insErr) {
    // Clean up the orphan blob if the DB insert failed.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return NextResponse.json({ document: { ...row, signed_url: signed?.signedUrl ?? null } });
}
