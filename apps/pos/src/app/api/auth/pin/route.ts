import { NextResponse, NextRequest } from "next/server";
import { createToken, verifyPin, hashPin, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";

const INV_SUPABASE_URL = process.env.LEGACY_INVENTORY_SUPABASE_URL || "";
const INV_ANON_KEY = process.env.LEGACY_INVENTORY_SUPABASE_ANON_KEY || "";

async function findActiveUsersWithPin(outletId?: string) {
  if (!INV_SUPABASE_URL || !INV_ANON_KEY) {
    throw new Error("LEGACY_INVENTORY_SUPABASE_URL + LEGACY_INVENTORY_SUPABASE_ANON_KEY env vars required");
  }
  let url = `${INV_SUPABASE_URL}/rest/v1/User?status=eq.ACTIVE&pin=not.is.null&select=id,name,role,pin,outletId`;
  if (outletId) {
    url += `&outletId=eq.${outletId}`;
  }
  const res = await fetch(url, {
    headers: {
      apikey: INV_ANON_KEY,
      Authorization: `Bearer ${INV_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    console.error("[AUTH] Supabase REST error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { pin, outletId } = await req.json();

    if (!pin || pin.length < 6) {
      return NextResponse.json({ error: "PIN required (6 digits)" }, { status: 400 });
    }

    // Scope to outlet if provided — prevents cross-outlet PIN collisions
    let candidates: any[] = [];
    try {
      const { prisma } = await import("@/lib/prisma");
      const where: any = { pin: { not: null }, status: "ACTIVE" };
      if (outletId) where.outletId = outletId;
      candidates = await prisma.user.findMany({
        where,
        include: { outlet: { select: { id: true, name: true } } },
      });
    } catch (prismaErr) {
      console.warn("[AUTH] Prisma fallback to Supabase REST:", prismaErr);
      candidates = await findActiveUsersWithPin(outletId);
    }

    // Find ALL matching PINs (not just first) to detect collisions
    const matches: typeof candidates = [];
    for (const user of candidates) {
      const userPin = user.pin;
      if (!userPin) continue;
      const { match } = await verifyPin(pin, userPin);
      if (match) matches.push(user);
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

    const user = matches[0];

    // Progressive rehash
    const { needsRehash } = await verifyPin(pin, user.pin);
    if (needsRehash) {
      try {
        const { prisma } = await import("@/lib/prisma");
        const hashed = await hashPin(pin);
        await prisma.user.update({ where: { id: user.id }, data: { pin: hashed } });
      } catch { /* ignore rehash errors */ }
    }

    const outletName = user.outlet?.name ?? null;
    const resolvedOutletId = user.outletId ?? user.outlet?.id ?? null;

    const token = await createToken({
      id: user.id,
      name: user.name,
      role: user.role,
      outletId: resolvedOutletId,
      outletName,
    });

    const response = NextResponse.json({
      id: user.id,
      name: user.name,
      role: user.role,
      outletId: resolvedOutletId,
      outletName,
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[AUTH] PIN login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
