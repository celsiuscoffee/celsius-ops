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

  const { pin, outletId } = await req.json();

  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: "PIN required (minimum 4 digits)" }, { status: 400 });
  }

  // Scope to outlet if provided — prevents cross-outlet PIN collisions
  const where: any = { pin: { not: null }, status: "ACTIVE" };
  if (outletId) where.outletId = outletId;

  const users = await prisma.user.findMany({
    where,
    include: { outlet: { select: { name: true } } },
  });

  // Find ALL matches to detect duplicates
  const matches: (typeof users)[number][] = [];
  for (const u of users) {
    if (u.role !== "OWNER" && u.role !== "ADMIN" && !u.appAccess.includes("ops")) continue;
    const { match, needsRehash } = await verifyPin(pin, u.pin);
    if (match) {
      if (needsRehash) {
        await prisma.user.update({
          where: { id: u.id },
          data: { pin: await hashPin(pin) },
        });
      }
      matches.push(u);
    }
  }

  if (matches.length === 0) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  if (matches.length > 1) {
    const names = matches.map((u) => u.name).join(", ");
    console.warn(`[AUTH] Duplicate PIN detected for: ${names}`);
    return NextResponse.json(
      { error: `Duplicate PIN — contact manager (${names})` },
      { status: 409 },
    );
  }

  const matchedUser = matches[0];

  await createSession({
    id: matchedUser.id,
    name: matchedUser.name,
    role: matchedUser.role,
    outletId: matchedUser.outletId,
    outletName: matchedUser.outlet?.name ?? null,
  });

  return NextResponse.json({
    id: matchedUser.id,
    name: matchedUser.name,
    role: matchedUser.role,
  });
}
