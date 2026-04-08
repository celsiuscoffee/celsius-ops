import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  let flatModuleAccess: string[] = [];
  if (user?.moduleAccess && typeof user.moduleAccess === "object" && !Array.isArray(user.moduleAccess)) {
    const ma = user.moduleAccess as Record<string, string[]>;
    for (const [app, modules] of Object.entries(ma)) {
      if (Array.isArray(modules)) {
        for (const mod of modules) {
          flatModuleAccess.push(`${app}:${mod}`);
        }
      }
    }
  } else if (Array.isArray(user?.moduleAccess)) {
    flatModuleAccess = user.moduleAccess as unknown as string[];
  }

  return NextResponse.json({
    ...session,
    hasPassword: !!user?.passwordHash,
    username: user?.username ?? null,
    appAccess: user?.appAccess ?? [],
    moduleAccess: flatModuleAccess,
  });
}
