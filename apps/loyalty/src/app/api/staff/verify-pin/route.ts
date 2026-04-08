import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPin, hashPin, createSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// POST /api/staff/verify-pin — verify staff PIN for portal login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { outlet_id, pin } = body;

    if (!outlet_id || !pin) {
      return NextResponse.json(
        { error: "outlet_id and pin are required" },
        { status: 400 }
      );
    }

    // Rate limit by outlet
    const rateCheck = await checkRateLimit(outlet_id, RATE_LIMITS.STAFF_PIN);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${rateCheck.retryAfter} seconds.` },
        { status: 429 }
      );
    }

    // Fetch active staff who have access to this outlet
    const staffList = await prisma.user.findMany({
      where: {
        role: "STAFF",
        status: "ACTIVE",
        OR: [
          { outletId: outlet_id },
          { outletIds: { has: outlet_id } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        outletId: true,
        outletIds: true,
        pin: true,
      },
    });

    // Find staff with matching PIN
    let matchedStaff = null;
    for (const s of staffList) {
      if (!s.pin) continue;

      // Progressive rehash: if plaintext PIN found, hash it
      if (!s.pin.startsWith("$2") && !s.pin.startsWith("$scrypt")) {
        if (s.pin === pin) {
          matchedStaff = s;
          // Rehash in background
          const hashed = await hashPin(pin);
          await prisma.user.update({
            where: { id: s.id },
            data: { pin: hashed },
          });
          break;
        }
        continue;
      }

      const pinMatch = await verifyPin(pin, s.pin);
      if (pinMatch) {
        matchedStaff = s;
        break;
      }
    }

    if (!matchedStaff) {
      return NextResponse.json(
        { error: "Invalid PIN or outlet" },
        { status: 401 }
      );
    }

    // Fetch outlet info (still from Supabase — outlets not yet in Prisma)
    // Import supabase only if needed for outlet lookup
    let outlet: { id: string; name: string } | null = null;
    try {
      const { supabaseAdmin } = await import("@/lib/supabase");
      const { data } = await supabaseAdmin
        .from("outlets")
        .select("id, name")
        .eq("id", outlet_id)
        .single();
      outlet = data;
    } catch {
      // Outlet lookup is non-critical
    }

    // Create session (sets celsius-session httpOnly cookie)
    await createSession({
      id: matchedStaff.id,
      name: matchedStaff.name,
      role: "STAFF",
      outletId: outlet_id,
    });

    return NextResponse.json({
      success: true,
      staff_name: matchedStaff.name,
      outlet_name: outlet?.name || "",
      staff: {
        id: matchedStaff.id,
        name: matchedStaff.name,
        email: matchedStaff.email,
        role: matchedStaff.role,
      },
      outlet: outlet || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
