import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const sop = await prisma.sop.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, name: true } },
      steps: { orderBy: { stepNumber: "asc" } },
      sopOutlets: {
        include: { outlet: { select: { id: true, code: true, name: true } } },
      },
    },
  });

  if (!sop) return NextResponse.json({ error: "SOP not found" }, { status: 404 });

  return NextResponse.json(sop);
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).optional(),
  categoryId: z.string().uuid().optional(),
  content: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body;
  try {
    body = updateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const existing = await prisma.sop.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "SOP not found" }, { status: 404 });

  const data: Record<string, unknown> = { ...body };

  // Set publishedAt when transitioning to PUBLISHED
  if (body.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    data.publishedAt = new Date();
  }

  // Increment version on content changes
  if (body.content && body.content !== existing.content) {
    data.version = existing.version + 1;
  }

  const sop = await prisma.sop.update({
    where: { id },
    data,
    include: {
      category: { select: { id: true, name: true } },
      _count: { select: { steps: true, sopOutlets: true } },
    },
  });

  return NextResponse.json(sop);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.sop.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
