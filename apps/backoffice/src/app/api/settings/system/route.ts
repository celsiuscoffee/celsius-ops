import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

// GET /api/settings/system — fetch system settings (public for all authenticated users)
export async function GET() {
  const settings = await prisma.systemSettings.findFirst({
    where: { id: "default" },
  });

  return NextResponse.json(settings || { id: "default", pinLength: 4 });
}

// PATCH /api/settings/system — update system settings (admin only)
export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  // PIN length — only 4 or 6
  if (body.pinLength !== undefined) {
    const pl = Number(body.pinLength);
    if (pl !== 4 && pl !== 6) {
      return NextResponse.json({ error: "PIN length must be 4 or 6" }, { status: 400 });
    }
    data.pinLength = pl;
  }

  const settings = await prisma.systemSettings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...data },
  });

  return NextResponse.json(settings);
}
