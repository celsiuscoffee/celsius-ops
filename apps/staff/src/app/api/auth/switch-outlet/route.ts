import { NextRequest, NextResponse } from "next/server";
import { getSession, createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Only managers/admins/owners can switch outlets
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { outletId } = await req.json();
  if (!outletId) {
    return NextResponse.json({ error: "outletId required" }, { status: 400 });
  }

  // Verify outlet exists
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true },
  });

  if (!outlet) {
    return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  }

  // A manager may only switch to an outlet within their own scope. OWNER/ADMIN
  // are unscoped. Without this, a manager assigned to outlet A could mint a
  // session for any outlet (existence was the only check) and reach outlet-B
  // data on every outlet-scoped route downstream.
  if (session.role === "MANAGER") {
    const me = await prisma.user.findUnique({
      where: { id: session.id },
      select: { outletId: true, outletIds: true },
    });
    const myOutlets = new Set<string>([
      ...(me?.outletId ? [me.outletId] : []),
      ...(me?.outletIds ?? []),
    ]);
    if (!myOutlets.has(outlet.id)) {
      return NextResponse.json({ error: "Outlet not in your scope" }, { status: 403 });
    }
  }

  // Create new session with updated outlet
  await createSession({
    id: session.id,
    name: session.name,
    role: session.role,
    outletId: outlet.id,
    outletName: outlet.name,
  });

  return NextResponse.json({ ok: true, outletId: outlet.id, outletName: outlet.name });
}
