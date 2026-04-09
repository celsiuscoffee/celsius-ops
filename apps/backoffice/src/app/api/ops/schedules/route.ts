import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const outletId = url.searchParams.get("outletId");
  const sopId = url.searchParams.get("sopId");
  const assignedToId = url.searchParams.get("assignedToId");

  const where: Record<string, unknown> = {};
  if (outletId) where.outletId = outletId;
  if (sopId) where.sopId = sopId;
  if (assignedToId) where.assignedToId = assignedToId;

  const schedules = await prisma.sopSchedule.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      sop: { select: { id: true, title: true, category: { select: { name: true } } } },
      outlet: { select: { id: true, code: true, name: true } },
      assignedTo: { select: { id: true, name: true, role: true } },
    },
  });

  return NextResponse.json(schedules);
}

const createSchema = z.object({
  sopId: z.string().uuid(),
  outletId: z.string().uuid(),
  assignedToId: z.string().uuid(),
  shift: z.enum(["OPENING", "MIDDAY", "CLOSING"]),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Check for duplicate
  const existing = await prisma.sopSchedule.findFirst({
    where: {
      sopId: body.sopId,
      outletId: body.outletId,
      assignedToId: body.assignedToId,
      shift: body.shift,
    },
  });
  if (existing) {
    return NextResponse.json({ error: "This schedule already exists" }, { status: 409 });
  }

  const schedule = await prisma.sopSchedule.create({
    data: {
      sopId: body.sopId,
      outletId: body.outletId,
      assignedToId: body.assignedToId,
      shift: body.shift,
      daysOfWeek: body.daysOfWeek,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    },
    include: {
      sop: { select: { id: true, title: true } },
      outlet: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(schedule, { status: 201 });
}
