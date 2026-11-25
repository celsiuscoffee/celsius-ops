import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hasModulePermission } from "@/lib/auth";
import { USAGE_ACTION, USAGE_MODULE, menuViews, pageOf, summarise, type UsageRow, type Viewport } from "@/lib/usage";

// Office usage: page views, internal only (declutter, 17 Nov 2026; ported from
// Gosamē Office). Stored in the existing ActivityLog table (module "usage",
// action "view"); no schema change and no outside service.
//
// POST { path, viewport }: the signed-in person opened a page (the shell sends
//   it, components/usage-tracker.tsx). The same page within 30 s counts once.
// GET ?days=30: the summary for Settings › Office Usage. Owners and admins,
//   and managers who may manage staff access (settings:staff).
export const dynamic = "force-dynamic";

const SAME_PAGE_MS = 30_000;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { path?: unknown; viewport?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path.slice(0, 300) : "";
  if (!path.startsWith("/")) return NextResponse.json({ error: "A page path starting with / is needed" }, { status: 400 });
  const viewport: Viewport = body?.viewport === "phone" ? "phone" : "desktop";
  const page = pageOf(path);

  try {
    // a reload or a back-and-forth on the same page is one view
    const recent = await prisma.activityLog.findFirst({
      where: { userId: user.id, module: USAGE_MODULE, action: USAGE_ACTION, targetName: page, createdAt: { gte: new Date(Date.now() - SAME_PAGE_MS) } },
      select: { id: true },
    });
    if (!recent) {
      await prisma.activityLog.create({
        data: { userId: user.id, module: USAGE_MODULE, action: USAGE_ACTION, targetName: page, details: JSON.stringify({ path, page, viewport }) },
      });
    }
  } catch (err) {
    // usage is best effort: never fail the page over it
    console.error("[usage] could not record a view:", err);
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  if (!(await hasModulePermission(user, "settings:staff", prisma))) {
    return NextResponse.json({ error: "Only owners, admins and managers with Staff & Access can see Office usage" }, { status: 403 });
  }

  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const now = new Date();
  // this period and the one before it (the reference), with a day to spare for the time zone
  const since = new Date(now.getTime() - (days * 2 + 1) * 86_400_000);

  const logs = await prisma.activityLog.findMany({
    where: { module: USAGE_MODULE, action: USAGE_ACTION, createdAt: { gte: since } },
    select: { userId: true, targetName: true, details: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const names = new Map<string, string>();
  const rows: UsageRow[] = logs.map((l) => {
    if (l.user?.name) names.set(l.userId, l.user.name);
    let viewport: Viewport = "desktop";
    try { if ((JSON.parse(l.details ?? "{}") as { viewport?: string }).viewport === "phone") viewport = "phone"; } catch { /* an odd row counts as desktop */ }
    return { userId: l.userId, page: l.targetName || "/", viewport, at: l.createdAt };
  });

  return NextResponse.json(summarise(rows, { days, now, names, menuPages: menuViews() }), { headers: { "Cache-Control": "no-store" } });
}
