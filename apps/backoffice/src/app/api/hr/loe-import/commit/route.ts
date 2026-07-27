import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "hr-documents";

type ImportRecord = {
  fileIndex: number;           // index into uploaded files[]
  name: string;
  fullName: string | null;
  role: "STAFF" | "MANAGER" | "ADMIN" | "OWNER";
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
};

type CommitResult = {
  fileName: string;
  status: "created" | "skipped" | "error";
  userId?: string;
  error?: string;
};

// POST multipart/form-data:
//   - `records`: JSON string of ImportRecord[]
//   - `file_0`, `file_1`, … : the matching LoE PDFs
// Creates User + hr_employee_profiles + uploads LoE into hr-documents.
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

  const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
  // Make sure bucket exists for LoE uploads
  if (supabase) {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: false });
    }
  }

  const results: CommitResult[] = [];

  for (const rec of records) {
    const file = form.get(`file_${rec.fileIndex}`) as File | null;
    const fileName = file?.name ?? `record_${rec.fileIndex}.pdf`;

    // Validation — required fields
    if (!rec.name) {
      results.push({ fileName, status: "error", error: "name is required" });
      continue;
    }
    if (rec.employmentType === "part_time" && !rec.hourlyRate) {
      results.push({ fileName, status: "error", error: "part-time requires hourly rate" });
      continue;
    }
    if (rec.employmentType === "full_time" && !rec.basicSalary) {
      results.push({ fileName, status: "error", error: "full-time requires basic salary" });
      continue;
    }

    try {
      // Uniqueness check — phone (if provided) shouldn't collide
      if (rec.phone) {
        const clash = await prisma.user.findUnique({ where: { phone: rec.phone } });
        if (clash) {
          results.push({
            fileName, status: "skipped",
            error: `Phone ${rec.phone} already registered to ${clash.name}`,
          });
          continue;
        }
      }

      // 1. Create the User
      const user = await prisma.user.create({
        data: {
          name: rec.name,
          fullName: rec.fullName,
          phone: rec.phone || null,
          email: rec.email || null,
          role: rec.role,
          outletId: rec.outletId || null,
          status: "ACTIVE",
          appAccess: [],
          moduleAccess: {},
        },
        select: { id: true },
      });

      // 2. Create hr_employee_profiles
      const { error: profErr } = await hrSupabaseAdmin
        .from("hr_employee_profiles")
        .insert({
          user_id: user.id,
          employment_type: rec.employmentType,
          position: rec.position || null,
          join_date: rec.joinDate || new Date().toISOString().slice(0, 10),
          basic_salary: rec.basicSalary ?? 0,
          hourly_rate: rec.hourlyRate ?? null,
          ic_number: rec.icNumber || null,
          performance_allowance_amount: rec.performanceAllowance,
          notes: rec.notes || null,
          nationality: "Malaysian",
        });
      if (profErr) {
        // Roll back the User so we don't leave an orphan
        await prisma.user.delete({ where: { id: user.id } });
        results.push({ fileName, status: "error", error: `Profile insert failed: ${profErr.message}` });
        continue;
      }

      // 3. Upload the LoE file to hr-documents + link in hr_employee_documents
      if (file && supabase) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const storagePath = `${user.id}/loe/${stamp}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, buffer, {
            contentType: file.type || "application/pdf",
            upsert: false,
          });
        if (!upErr) {
          await hrSupabaseAdmin.from("hr_employee_documents").insert({
            user_id: user.id,
            doc_type: "loe",
            title: `LoE — ${rec.joinDate || "imported"}`,
            file_name: file.name,
            storage_path: storagePath,
            size_bytes: buffer.byteLength,
            mime_type: file.type || "application/pdf",
            effective_date: rec.joinDate || null,
            uploaded_by: session.id,
          });
        }
      }

      // 4. Salary + job history audit trails
      await hrSupabaseAdmin.from("hr_salary_history").insert({
        user_id: user.id,
        effective_date: rec.joinDate || new Date().toISOString().slice(0, 10),
        salary_type: rec.employmentType === "part_time" ? "hourly" : "monthly",
        amount: rec.employmentType === "part_time" ? (rec.hourlyRate ?? 0) : (rec.basicSalary ?? 0),
        comment: `Imported from LoE ${file?.name ?? ""}`.trim(),
        created_by: session.id,
      });
      await hrSupabaseAdmin.from("hr_job_history").insert({
        user_id: user.id,
        effective_date: rec.joinDate || new Date().toISOString().slice(0, 10),
        job_title: rec.position || rec.role,
        outlet_id: rec.outletId || null,
        employment_type: rec.employmentType,
        note: "Imported from LoE",
        created_by: session.id,
      });

      results.push({ fileName, status: "created", userId: user.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ fileName, status: "error", error: message });
    }
  }

  return NextResponse.json({ results });
}
