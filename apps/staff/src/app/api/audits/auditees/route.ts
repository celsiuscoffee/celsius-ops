import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/audits/auditees?templateId=...&outletId=...
// Returns staff at the given outlet whose hr_employee_profiles.position matches
// the template's jobRoleFilter. Powers the staff picker on the audit-creation
// form when the chosen template is auditTarget = STAFF.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const templateId = searchParams.get("templateId");
  const outletId = searchParams.get("outletId");

  if (!templateId || !outletId) {
    return NextResponse.json({ error: "templateId and outletId required" }, { status: 400 });
  }

  const template = await prisma.auditTemplate.findUnique({
    where: { id: templateId },
    select: { auditTarget: true, jobRoleFilter: true },
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.auditTarget !== "STAFF") return NextResponse.json([]);

  // All STAFF users assigned to this outlet (via outletId scalar or outletIds
  // array — the same scoping used elsewhere in the codebase).
  const candidates = await prisma.user.findMany({
    where: {
      role: "STAFF",
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
    },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });

  if (!template.jobRoleFilter) {
    return NextResponse.json(
      candidates.map((c) => ({ id: c.id, name: c.fullName ?? c.name, position: null })),
    );
  }

  // Filter by hr_employee_profiles.position. Done in one query against the
  // candidate user_id list rather than per-user round-trips.
  const userIds = candidates.map((c) => c.id);
  const { data: profiles, error } = await supabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position")
    .in("user_id", userIds)
    .eq("position", template.jobRoleFilter);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const matchedIds = new Set((profiles ?? []).map((p) => p.user_id as string));
  const positionByUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p.position as string]));

  const result = candidates
    .filter((c) => matchedIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.fullName ?? c.name,
      position: positionByUser.get(c.id) ?? null,
    }));

  return NextResponse.json(result);
}
