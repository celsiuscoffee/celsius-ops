import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Response schema — strict so the UI can render a review table reliably.
type LoeRecord = {
  fileName: string;
  name: string;
  fullName: string | null;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  position: string | null;
  outletName: string | null;
  joinDate: string | null;     // YYYY-MM-DD
  basicSalary: number | null;  // monthly RM
  hourlyRate: number | null;   // per-hour RM
  performanceAllowance: number | null;
  phone: string | null;
  email: string | null;
  icNumber: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  error?: string;
};

const EXTRACT_PROMPT = `You are parsing a Letter of Employment (LoE) or Offer Letter from a Malaysian coffee chain. Extract ONLY the fields below into a single JSON object. Do not include any other text.

Schema:
{
  "name": string,                    // short display name used day-to-day, e.g. "Adam Kelvin" or first name + last name. Derive from "Dear <name>" if no explicit display name.
  "fullName": string | null,         // full legal name as printed (full caps OK). Preserve bin/binti.
  "employmentType": "full_time" | "part_time" | "contract" | "intern",
  "position": string | null,         // e.g. "Barista", "Area Manager", "Part-Time Barista"
  "outletName": string | null,       // branch name if mentioned (e.g. "Celsius Coffee Shah Alam", "IOI Conezion"). Null if not stated.
  "joinDate": string | null,         // YYYY-MM-DD. Parse phrases like "1st April 2026", "25 October 2025", "13 MAY 2024", "8 Dicember 2023" etc. Must be ISO.
  "basicSalary": number | null,      // monthly base salary in RM. null for part-time. E.g. "RM 1,900.00" -> 1900.
  "hourlyRate": number | null,       // RM per hour for part-timers. null for FT. E.g. "RM9.00 per hour" -> 9.
  "performanceAllowance": number | null, // "Performance allowance: up to RM X monthly" -> X. null if not mentioned.
  "phone": string | null,            // if on the letter; usually absent
  "email": string | null,            // if on the letter; usually absent
  "icNumber": string | null,         // Malaysian IC if printed (format 000000-00-0000)
  "notes": string | null,            // any unusual clause worth flagging (fixed allowance, supervisor role, probation length, etc.)
  "confidence": "high" | "medium" | "low"  // "low" if fields are missing or ambiguous
}

Rules:
- Malay months: "Januari/Februari/Mac/April/Mei/Jun/Julai/Ogos/September/Oktober/November/Disember". Handle typos like "Dicember" -> December.
- "Part-time", "hourly-rated" -> employmentType="part_time".
- Base wage / basic salary / "shall receive a monthly base salary" -> basicSalary.
- If the letter says BOTH an amount and an allowance, separate them.
- "RM2000 per month and allowance RM300" -> basicSalary=2000, performanceAllowance=null, notes="Fixed allowance RM 300 mentioned — classify manually".
- Return STRICT JSON. No code fences, no prose.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractOne(file: File): Promise<LoeRecord> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");

  const mediaType = file.type === "application/pdf" ? "application/pdf"
    : file.type.startsWith("image/") ? file.type : "application/pdf";

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            mediaType === "application/pdf"
              ? {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: base64 },
                } as Anthropic.ContentBlockParam
              : {
                  type: "image",
                  source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: base64 },
                } as Anthropic.ContentBlockParam,
            { type: "text", text: EXTRACT_PROMPT },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Strip accidental code fences
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);

    return {
      fileName: file.name,
      name: parsed.name || file.name.replace(/\.pdf$/i, ""),
      fullName: parsed.fullName ?? null,
      employmentType: parsed.employmentType || "full_time",
      position: parsed.position ?? null,
      outletName: parsed.outletName ?? null,
      joinDate: parsed.joinDate ?? null,
      basicSalary: parsed.basicSalary ?? null,
      hourlyRate: parsed.hourlyRate ?? null,
      performanceAllowance: parsed.performanceAllowance ?? null,
      phone: parsed.phone ?? null,
      email: parsed.email ?? null,
      icNumber: parsed.icNumber ?? null,
      notes: parsed.notes ?? null,
      confidence: parsed.confidence || "medium",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return {
      fileName: file.name,
      name: file.name.replace(/\.pdf$/i, ""),
      fullName: null,
      employmentType: "full_time",
      position: null,
      outletName: null,
      joinDate: null,
      basicSalary: null,
      hourlyRate: null,
      performanceAllowance: null,
      phone: null,
      email: null,
      icNumber: null,
      notes: null,
      confidence: "low",
      error: message,
    };
  }
}

// POST multipart/form-data with one or more `files` fields.
// Returns { records: LoeRecord[] } in the same order as the uploaded files.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // Parse up to 10 at a time to avoid hammering Anthropic concurrency.
  const BATCH = 10;
  const records: LoeRecord[] = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH);
    const batch = await Promise.all(slice.map(extractOne));
    records.push(...batch);
  }

  return NextResponse.json({ records });
}
