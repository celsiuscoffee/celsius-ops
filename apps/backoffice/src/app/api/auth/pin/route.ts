import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
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

  // Find active users matching this PIN
  const users = await prisma.user.findMany({
    where: {
      pin: pin.trim(),
      status: "ACTIVE",
    },
    include: { outlet: { select: { name: true } } },
  });

  // Find the best match: OWNER/ADMIN bypass appAccess, others need "backoffice"
  const user = users.find((u) => {
    if (u.role === "OWNER" || u.role === "ADMIN") return true;
    return u.appAccess.includes("backoffice");
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  // Staff role cannot access backoffice
  if (user.role === "STAFF") {
    return NextResponse.json({ error: "Unauthorized — no backoffice access" }, { status: 403 });
  }

  await createSession({
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: user.outletId,
    outletName: user.outlet?.name ?? null,
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    role: user.role,
  });
}
