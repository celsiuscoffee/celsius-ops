import { NextResponse } from "next/server";
import { getSession } from "@celsius/auth";
import { getSkillsCoachInsights } from "@/lib/hr/agents/skills-coach";

export const dynamic = "force-dynamic";

// GET /api/ops/audit-reports/staff/[userId]/coach
// Returns AI-coach insights for the auditee's skill audit history. Cached
// per latest audit id, so repeat calls don't hit Claude until new audit data
// arrives. Backoffice is admin-only; route just enforces auth.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const result = await getSkillsCoachInsights(userId);
  return NextResponse.json(result);
}
