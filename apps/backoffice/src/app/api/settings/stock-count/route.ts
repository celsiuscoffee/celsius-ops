import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

const KEY = "stock_count_schedule";
const DEFAULT_SCHEDULE = { weeklyDays: [0, 2, 4], endOfMonthDays: [28, 29, 30, 31] };

export async function GET() {
  const config = await prisma.appConfig.findUnique({ where: { key: KEY } });
  return NextResponse.json(config?.value ?? DEFAULT_SCHEDULE);
}

export async function PUT(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { weeklyDays, endOfMonthDays } = body as { weeklyDays: number[]; endOfMonthDays: number[] };

  const value = {
    weeklyDays: weeklyDays ?? DEFAULT_SCHEDULE.weeklyDays,
    endOfMonthDays: endOfMonthDays ?? DEFAULT_SCHEDULE.endOfMonthDays,
  };

  await prisma.appConfig.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value },
  });

  return NextResponse.json(value);
}
