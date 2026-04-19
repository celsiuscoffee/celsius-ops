import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { flattenModuleAccess } from "@celsius/shared";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { passwordHash: true, username: true, appAccess: true, moduleAccess: true },
  });

  // Flatten moduleAccess from { settings: ["outlets","staff"] } → ["settings:outlets","settings:staff"]
  // Legacy rows that stored a flat string[] are accepted, but we filter out
  // non-string elements in case the column was ever written with bad data.
  const flatModuleAccess = Array.isArray(user?.moduleAccess)
    ? user.moduleAccess.filter((x): x is string => typeof x === "string")
    : flattenModuleAccess(user?.moduleAccess);

  return NextResponse.json({
    ...session,
    hasPassword: !!user?.passwordHash,
    username: user?.username ?? null,
    appAccess: user?.appAccess ?? [],
    moduleAccess: flatModuleAccess,
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
