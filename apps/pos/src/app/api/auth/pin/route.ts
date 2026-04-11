import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createToken, verifyPin, hashPin, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";

// Use the inventory Supabase project (where User table lives via Prisma)
const supabase = createClient(
  "https://akkwdrllvcpnkzgmclkk.supabase.co",
  // Service role key not needed — User table has RLS disabled
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! // Falls back to anon key
);

// Direct SQL via Supabase REST — bypass Prisma for Vercel compatibility
const INV_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFra3dkcmxsdmNwbmt6Z21jbGtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNzE2MDgsImV4cCI6MjA5MDY0NzYwOH0.XtLmsUyB3kUT2pvpNoFR7KxkEldxgEF7k2Q-sCc131s";

async function findActiveUsersWithPin() {
  const res = await fetch(
    `https://akkwdrllvcpnkzgmclkk.supabase.co/rest/v1/User?status=eq.ACTIVE&pin=not.is.null&select=id,name,role,pin,outletId`,
    {
      headers: {
        apikey: INV_ANON_KEY,
        Authorization: `Bearer ${INV_ANON_KEY}`,
      },
    }
  );
  if (!res.ok) {
    console.error("[AUTH] Supabase REST error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { pin } = await req.json();

    if (!pin || pin.length < 4) {
      return NextResponse.json({ error: "PIN required (minimum 4 digits)" }, { status: 400 });
    }

    // Try Prisma first, fall back to direct Supabase REST
    let candidates: any[] = [];
    try {
      const { prisma } = await import("@/lib/prisma");
      candidates = await prisma.user.findMany({
        where: { pin: { not: null }, status: "ACTIVE" },
        include: { outlet: { select: { id: true, name: true } } },
      });
    } catch (prismaErr) {
      console.warn("[AUTH] Prisma fallback to Supabase REST:", prismaErr);
      candidates = await findActiveUsersWithPin();
    }

    for (const user of candidates) {
      const userPin = user.pin;
      if (!userPin) continue;

      const { match, needsRehash } = await verifyPin(pin, userPin);
      if (!match) continue;

      // Progressive rehash
      if (needsRehash) {
        try {
          const { prisma } = await import("@/lib/prisma");
          const hashed = await hashPin(pin);
          await prisma.user.update({ where: { id: user.id }, data: { pin: hashed } });
        } catch { /* ignore rehash errors */ }
      }

      const outletName = user.outlet?.name ?? null;
      const outletId = user.outletId ?? user.outlet?.id ?? null;

      const token = await createToken({
        id: user.id,
        name: user.name,
        role: user.role,
        outletId,
        outletName,
      });

      const response = NextResponse.json({
        id: user.id,
        name: user.name,
        role: user.role,
        outletId,
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
    }

    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  } catch (err) {
    console.error("[AUTH] PIN login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
