import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const assignments = await prisma.sopOutlet.findMany({
    where: { sopId: id },
    include: { outlet: { select: { id: true, code: true, name: true } } },
  });

  return NextResponse.json(assignments);
}

const assignSchema = z.object({
  outletIds: z.array(z.string().uuid()),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body;
  try {
    body = assignSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sop = await prisma.sop.findUnique({ where: { id } });
  if (!sop) return NextResponse.json({ error: "SOP not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.sopOutlet.deleteMany({ where: { sopId: id } });
    if (body.outletIds.length > 0) {
      await tx.sopOutlet.createMany({
        data: body.outletIds.map((outletId) => ({ sopId: id, outletId })),
      });
    }
    return tx.sopOutlet.findMany({
      where: { sopId: id },
      include: { outlet: { select: { id: true, code: true, name: true } } },
    });
  });

  return NextResponse.json(result);
}
