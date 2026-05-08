import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getSkillsCoachInsights } from "@/lib/hr/agents/skills-coach";

export const dynamic = "force-dynamic";

function hasModule(
  role: string,
  moduleAccess: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (!moduleAccess) return false;
  if (key.includes(":")) {
    const [app, mod] = key.split(":");
    const appAccess = moduleAccess[app];
    if (appAccess === true) return true;
    if (Array.isArray(appAccess)) return appAccess.includes(mod);
    return false;
  }
  const appAccess = moduleAccess[key];
  if (appAccess === true) return true;
  if (Array.isArray(appAccess) && appAccess.length > 0) return true;
  return false;
}

// GET /api/audits/staff/[userId]/coach
// Returns AI-coach insights for the auditee. Same auth model as the history
// endpoint: self, manager-on-same-outlet, or admin.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  const me = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outletIds: true },
  });
  const moduleAccess = (me?.moduleAccess ?? null) as Record<string, unknown> | null;
  const isManager = hasModule(session.role, moduleAccess, "ops:audit");
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const isSelf = session.id === userId;

  if (!isSelf && !isManager && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isSelf && isManager && !isAdmin) {
    const auditee = await prisma.user.findUnique({
      where: { id: userId },
      select: { outletId: true, outletIds: true },
    });
    const auditeeOutlets = new Set<string>([
      ...(auditee?.outletId ? [auditee.outletId] : []),
      ...(auditee?.outletIds ?? []),
    ]);
    const myOutlets = new Set<string>([
      ...(me?.outletId ? [me.outletId] : []),
      ...(me?.outletIds ?? []),
    ]);
    const sharesOutlet = [...auditeeOutlets].some((o) => myOutlets.has(o));
    if (!sharesOutlet) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await getSkillsCoachInsights(userId);
  return NextResponse.json(result);
}
