import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/settings/system — fetch system settings (for login page PIN length)
export async function GET() {
  const settings = await prisma.systemSettings.findFirst({
    where: { id: "default" },
  });

  return NextResponse.json({ pinLength: settings?.pinLength || 4 });
}
