import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { verifyPin, hashPin } from "@celsius/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterMs } = checkRateLimit(`pin:${ip}`, 10, 300_000);
  if (limited) {
    return NextResponse.json(
      { error: "Too many PIN attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const { pin } = await req.json();

  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: "PIN required (minimum 4 digits)" }, { status: 400 });
  }

  // Fetch all active users who have a PIN set
  const users = await prisma.user.findMany({
    where: {
      pin: { not: null },
      status: "ACTIVE",
    },
    include: { outlet: { select: { name: true } } },
  });

  // Verify PIN against each user's hash (supports bcrypt + legacy plaintext)
  let matchedUser: (typeof users)[number] | null = null;
  for (const u of users) {
    // Filter for users with backoffice access (OWNER/ADMIN bypass)
    if (u.role !== "OWNER" && u.role !== "ADMIN" && !u.appAccess.includes("backoffice")) continue;

    const { match, needsRehash } = await verifyPin(pin, u.pin);
    if (match) {
      matchedUser = u;
      // Migrate plaintext PIN to bcrypt hash
      if (needsRehash) {
        await prisma.user.update({
          where: { id: u.id },
          data: { pin: await hashPin(pin) },
        });
      }
      break;
    }
  }

  if (!matchedUser) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  // Staff role cannot access backoffice
  if (matchedUser.role === "STAFF") {
    return NextResponse.json({ error: "Unauthorized — no backoffice access" }, { status: 403 });
  }

  await createSession({
    id: matchedUser.id,
    name: matchedUser.name,
    role: matchedUser.role,
    outletId: matchedUser.outletId,
    outletName: matchedUser.outlet?.name ?? null,
  });

  // Flatten moduleAccess for backoffice format: { ops: ["audit"] } → ["ops:audit"]
  const rawMa = (matchedUser.moduleAccess ?? {}) as Record<string, unknown>;
  const flatModuleAccess: string[] = [];
  for (const [app, modules] of Object.entries(rawMa)) {
    if (modules === true) {
      flatModuleAccess.push(app);
    } else if (Array.isArray(modules)) {
      for (const mod of modules) flatModuleAccess.push(`${app}:${mod}`);
    }
  }

  return NextResponse.json({
    id: matchedUser.id,
    name: matchedUser.name,
    role: matchedUser.role,
    moduleAccess: flatModuleAccess,
  });
}
