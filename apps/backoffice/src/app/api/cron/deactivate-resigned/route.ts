import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nightly cron — flips User.status → DEACTIVATED for anyone whose
// hr_employee_profiles.end_date has passed. Vercel schedule: 00:05 MYT
// (16:05 UTC previous day).
//
// Auth: Bearer token in CRON_SECRET env var (Vercel auto-sets).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const today = new Date().toISOString().slice(0, 10);

  // Find profiles with end_date on/before today
  const { data: expired } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, end_date, resigned_at")
    .not("end_date", "is", null)
    .lte("end_date", today);

  if (!expired || expired.length === 0) {
    return NextResponse.json({ checked: today, deactivated: 0 });
  }

  // Only deactivate users currently ACTIVE
  const userIds = expired.map((e: { user_id: string }) => e.user_id);
  const activeUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, status: "ACTIVE" },
    select: { id: true, name: true, fullName: true },
  });

  const deactivated: string[] = [];
  for (const u of activeUsers) {
    await prisma.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } });
    deactivated.push(u.fullName || u.name);
  }

  return NextResponse.json({
    checked: today,
    deactivated: deactivated.length,
    names: deactivated,
  });
}
