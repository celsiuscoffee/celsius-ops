import { NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { getSession } from "@celsius/auth";

// GET — distinct job roles in use across the org. Powers the Job Role
// dropdown when building a STAFF audit template. We pull live from
// hr_employee_profiles so any new role HR adds (e.g. "Trainer") shows up
// without code changes.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("position")
    .not("position", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const roles = Array.from(
    new Set((data ?? []).map((r) => (r.position as string | null)?.trim()).filter(Boolean) as string[]),
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json(roles);
}
