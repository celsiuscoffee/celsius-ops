import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Fetch moduleAccess + current outlet from DB (not trusted from the JWT).
  // moduleAccess is always returned fresh so access-preset changes propagate
  // on the next app launch. outletId is FILLED from the DB only when the token
  // lacks one — so a stale/old session (e.g. logged in before an outlet was
  // assigned) self-heals, while a manager who deliberately switched outlets
  // (token outletId set) keeps their selection.
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true, outletId: true, outlet: { select: { name: true } } },
  });

  return NextResponse.json(
    {
      ...session,
      outletId: session.outletId ?? user?.outletId ?? null,
      outletName: session.outletName ?? user?.outlet?.name ?? null,
      moduleAccess: user?.moduleAccess ?? {},
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
