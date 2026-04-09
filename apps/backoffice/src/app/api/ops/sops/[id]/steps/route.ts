import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const steps = await prisma.sopStep.findMany({
    where: { sopId: id },
    orderBy: { stepNumber: "asc" },
  });

  return NextResponse.json(steps);
}

const stepSchema = z.object({
  stepNumber: z.number().int().min(1),
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional(),
});

const bulkSchema = z.object({
  steps: z.array(stepSchema),
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
    body = bulkSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sop = await prisma.sop.findUnique({ where: { id } });
  if (!sop) return NextResponse.json({ error: "SOP not found" }, { status: 404 });

  // Replace all steps in a transaction
  const result = await prisma.$transaction(async (tx) => {
    await tx.sopStep.deleteMany({ where: { sopId: id } });
    if (body.steps.length > 0) {
      await tx.sopStep.createMany({
        data: body.steps.map((step) => ({
          sopId: id,
          stepNumber: step.stepNumber,
          title: step.title,
          description: step.description,
          imageUrl: step.imageUrl,
        })),
      });
    }
    return tx.sopStep.findMany({
      where: { sopId: id },
      orderBy: { stepNumber: "asc" },
    });
  });

  return NextResponse.json(result);
}
