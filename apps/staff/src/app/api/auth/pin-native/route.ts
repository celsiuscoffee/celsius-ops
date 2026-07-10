import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { verifyPin, hashPin } from "@celsius/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterMs } = await checkRateLimit(`pin-native:${ip}`, 10, 300_000);
  if (limited) {
    return NextResponse.json(
      { error: "Too many PIN attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  let body: { pin?: string; outletId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { pin, outletId } = body;
  if (!pin || pin.length !== 6) {
    return NextResponse.json({ error: "PIN must be 6 digits" }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: { pin: { not: null }, status: "ACTIVE" },
    include: { outlet: { select: { name: true } } },
  });

  const matches: (typeof users)[number][] = [];
  for (const u of users) {
    if (u.role !== "OWNER" && u.role !== "ADMIN" && !u.appAccess.includes("ops")) continue;
    if (
      outletId &&
      u.role !== "OWNER" &&
      u.role !== "ADMIN" &&
      u.outletId !== outletId &&
      !u.outletIds.includes(outletId)
    ) continue;
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
    // Names stay server-side only: this response reaches UNAUTHENTICATED
    // callers, so echoing the colliding accounts leaked real staff names and
    // confirmed the guessed PIN was live. Ops can identify the pair from logs.
    const names = matches.map((u) => u.name).join(", ");
    console.warn(`[AUTH] Duplicate PIN detected for: ${names}`);
    return NextResponse.json(
      { error: "PIN conflict. Ask your manager to reset your PIN." },
      { status: 409 },
    );
  }

  const u = matches[0];
  const finalOutletId = outletId || u.outletId;
  const selectedOutlet = finalOutletId
    ? await prisma.outlet.findUnique({ where: { id: finalOutletId }, select: { name: true } })
    : null;

  const sessionUser = {
    id: u.id,
    name: u.name,
    role: u.role,
    outletId: finalOutletId,
    outletName: selectedOutlet?.name ?? u.outlet?.name ?? null,
  };

  const token = await createToken(sessionUser);

  return NextResponse.json({
    token,
    user: {
      id: u.id,
      name: u.name,
      role: u.role,
      outletId: finalOutletId,
      outletName: sessionUser.outletName,
      moduleAccess: u.moduleAccess ?? {},
    },
  });
}
