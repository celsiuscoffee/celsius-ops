import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { createClient } from "@supabase/supabase-js";
import { HireError, hireEmployee, type HireRole } from "@/lib/hr/hire";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "hr-documents";

const makeStorageClient = () =>
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
type StorageClient = ReturnType<typeof makeStorageClient>;

type ImportRecord = {
  fileIndex: number;           // index into uploaded files[]
  name: string;
  fullName: string | null;
  role: HireRole;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  position: string | null;
  outletId: string | null;     // resolved on client
  joinDate: string | null;
  basicSalary: number | null;
  hourlyRate: number | null;
  performanceAllowance: number | null;
  phone: string | null;
  email: string | null;
  icNumber: string | null;
  notes: string | null;
  // Never printed on a Letter of Employment — typed in on the review screen so
  // a bulk import doesn't have to be finished by hand, one employee page at a
  // time. That manual round is how staff ended up with no EPF number and no
  // bank account, which the KWSP and payment files then silently skip.
  epfNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  pin: string | null;
};

type CommitResult = {
  fileName: string;
  status: "created" | "skipped" | "error";
  userId?: string;
  /** Set when the employee was created but their LoE could not be filed. */
  warning?: string;
  error?: string;
};

// POST multipart/form-data:
//   - `records`: JSON string of ImportRecord[]
//   - `file_0`, `file_1`, … : the matching LoE PDFs
//
// Each record is hired through lib/hr/hire, the single provisioning path, so
// an imported employee is indistinguishable from one created through the
// backoffice form: access preset, leave balances, IC-derived DOB/gender,
// stations and the salary/job audit rows all come with them.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const recordsRaw = form.get("records");
  if (typeof recordsRaw !== "string") {
    return NextResponse.json({ error: "records JSON required" }, { status: 400 });
  }
  let records: ImportRecord[];
  try {
    records = JSON.parse(recordsRaw);
  } catch {
    return NextResponse.json({ error: "Invalid records JSON" }, { status: 400 });
  }

  const supabase = makeStorageClient();
  // Make sure bucket exists for LoE uploads
  if (supabase) {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: false });
    }
  }

  const results: CommitResult[] = [];

  // Sequential on purpose. Each hire commits before the next one is checked,
  // so a phone, email, IC or PIN repeated WITHIN this batch trips the same
  // gates that catch a clash with somebody already on file.
  for (const rec of records) {
    const file = form.get(`file_${rec.fileIndex}`) as File | null;
    const fileName = file?.name ?? `record_${rec.fileIndex}.pdf`;

    // An import must not mint an OWNER from a client-edited record.
    if (rec.role === "OWNER" && session.role !== "OWNER") {
      results.push({ fileName, status: "error", error: "Only an OWNER can create an OWNER account" });
      continue;
    }

    let userId: string;
    try {
      const hired = await hireEmployee({
        name: rec.name,
        fullName: rec.fullName,
        phone: rec.phone,
        email: rec.email,
        role: rec.role,
        outletId: rec.outletId,
        position: rec.position,
        employmentType: rec.employmentType,
        joinDate: rec.joinDate,
        basicSalary: rec.basicSalary,
        hourlyRate: rec.hourlyRate,
        performanceAllowance: rec.performanceAllowance,
        icNumber: rec.icNumber,
        epfNumber: rec.epfNumber,
        bankName: rec.bankName,
        bankAccountNumber: rec.bankAccountNumber,
        bankAccountName: rec.bankAccountName,
        pin: rec.pin,
        notes: rec.notes,
        createdBy: session.id,
        salaryComment: `Imported from LoE ${fileName}`.trim(),
        jobNote: "Imported from LoE",
      });
      userId = hired.userId;
    } catch (err) {
      if (err instanceof HireError) {
        // A duplicate is the human's call to resolve, not an error in the
        // file — report it as skipped so the batch summary stays honest.
        results.push({
          fileName,
          status: err.code === "duplicate" ? "skipped" : "error",
          error: err.message,
        });
        continue;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ fileName, status: "error", error: message });
      continue;
    }

    // Filing the letter happens after the hire commits, because object
    // storage cannot join the transaction. A failure here leaves a correct
    // employee with an unfiled letter, so it is reported rather than
    // swallowed — the old code dropped it silently and the document simply
    // never appeared.
    const warning = await fileLetter(supabase, file, userId, rec.joinDate, session.id);
    results.push({ fileName, status: "created", userId, ...(warning ? { warning } : {}) });
  }

  return NextResponse.json({ results });
}

/** Upload the LoE and link it on the employee. Returns a warning, or null. */
async function fileLetter(
  supabase: StorageClient,
  file: File | null,
  userId: string,
  joinDate: string | null,
  uploadedBy: string,
): Promise<string | null> {
  if (!file) return null;
  if (!supabase) return "Employee created, but the LoE was not filed (document storage is not configured)";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storagePath = `${userId}/loe/${stamp}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });
    if (upErr) return `Employee created, but the LoE was not filed: ${upErr.message}`;

    const { error: docErr } = await hrSupabaseAdmin.from("hr_employee_documents").insert({
      user_id: userId,
      doc_type: "loe",
      title: `LoE — ${joinDate || "imported"}`,
      file_name: file.name,
      storage_path: storagePath,
      size_bytes: buffer.byteLength,
      mime_type: file.type || "application/pdf",
      effective_date: joinDate || null,
      uploaded_by: uploadedBy,
    });
    if (docErr) return `Employee created and the LoE uploaded, but linking it failed: ${docErr.message}`;
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return `Employee created, but the LoE was not filed: ${message}`;
  }
}
