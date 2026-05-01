import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";

/**
 * GET /api/cron/reset-checklists
 * Runs daily at 12:00am MYT (4:00pm UTC previous day).
 *
 * Only deletes PENDING (uncompleted) checklists for the new day
 * so they regenerate fresh when staff open the app.
 *
 * Completed/in-progress checklists from any day are preserved for records.
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  // 12am MYT = the start of the new MYT day
  const mytDateStr = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const [y, mo, d] = mytDateStr.split("-").map(Number);
  const todayMyt = new Date(Date.UTC(y, mo - 1, d));

  // Only delete PENDING checklists for today (not completed ones)
  const deletedItems = await prisma.checklistItem.deleteMany({
    where: {
      checklist: {
        date: todayMyt,
        status: "PENDING",
      },
    },
  });

  const deletedChecklists = await prisma.checklist.deleteMany({
    where: {
      date: todayMyt,
      status: "PENDING",
    },
  });

  return NextResponse.json({
    message: "Daily checklist reset complete",
    date: todayMyt.toISOString(),
    deletedChecklists: deletedChecklists.count,
    deletedItems: deletedItems.count,
  });
}
