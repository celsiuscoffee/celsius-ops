import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const KEY = "stock_count_schedule";
const DEFAULT_SCHEDULE = { weeklyDays: [0, 2, 4], endOfMonthDays: [28, 29, 30, 31] };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.appConfig.findUnique({ where: { key: KEY } });
  return NextResponse.json(config?.value ?? DEFAULT_SCHEDULE);
}
