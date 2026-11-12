import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds, resolveVisibleUserIds } from "@/lib/hr/scope";
import { sourcesFor, type InboxContext } from "@/lib/inbox/sources";
import { sortInbox, type InboxItem, type InboxResponse } from "@/lib/inbox/types";
import type { UserProfile } from "@/lib/nav";

// GET /api/inbox — every decision waiting on the signed-in person, read from the
// existing approval queues (lib/inbox/sources.ts). Read only. Sources run in
// parallel; one failing is reported in `unavailable`, never hides the rest.
export const dynamic = "force-dynamic";

function flattenModuleAccess(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).flatMap(([app, mods]) =>
      Array.isArray(mods) ? mods.map((m) => `${app}:${m}`) : [],
    );
  }
  return [];
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [me, outletIds, teamIds, outlets, users] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.id }, select: { moduleAccess: true } }),
    getAccessibleOutletIds(session),
    resolveVisibleUserIds(session),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true, fullName: true } }),
  ]);

  const user: UserProfile = {
    id: session.id, name: session.name, role: session.role, outletId: session.outletId,
    moduleAccess: flattenModuleAccess(me?.moduleAccess),
  };
  const outletById = new Map(outlets.map((o) => [o.id, o.name]));
  // Short names in cards: "Mira", not "Mira Binti Iskandar".
  const userById = new Map(users.map((u) => [u.id, (u.name || u.fullName || "").trim()]));

  const ctx: InboxContext = {
    user, outletIds, teamIds, now: new Date(),
    outletName: (id) => (id && outletById.get(id)) || "an outlet",
    userName: (id) => (id && userById.get(id)) || "someone",
  };

  const sources = sourcesFor(user);
  const results = await Promise.allSettled(sources.map((s) => s.load(ctx)));
  const items: InboxItem[] = [];
  const unavailable: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else {
      unavailable.push(sources[i].label);
      console.error(`[inbox] source ${sources[i].key} failed`, r.reason);
    }
  });

  const sorted = sortInbox(items);
  const body: InboxResponse = {
    items: sorted,
    counts: { total: sorted.length, now: sorted.filter((i) => i.when === "now").length },
    unavailable,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
