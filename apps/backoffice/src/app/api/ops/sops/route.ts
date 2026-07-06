import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const categoryId = url.searchParams.get("categoryId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  const outletId = url.searchParams.get("outletId");

  const where: Record<string, unknown> = {};
  if (categoryId) where.categoryId = categoryId;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }
  if (outletId) {
    where.sopOutlets = { some: { outletId } };
  }

  const sops = await prisma.sop.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      category: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { steps: true, sopOutlets: true } },
    },
  });

  return NextResponse.json(sops);
}

const createSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).optional(),
  categoryId: z.string().uuid(),
  content: z.string().optional(),
  stations: z.array(z.enum(["foh", "boh", "lead", "shared"])).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
  expectedRecurrence: z.enum(["SHIFT", "SPECIFIC_TIMES", "HOURLY"]).optional(),
  expectedTimesPerDay: z.number().int().min(1).optional(),
  expectedDueMinutes: z.number().int().min(0).optional(),
  appliesToAllOutlets: z.boolean().optional(),
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

  const category = await prisma.sopCategory.findUnique({ where: { id: body.categoryId } });
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const sop = await prisma.sop.create({
    data: {
      title: body.title,
      description: body.description,
      categoryId: body.categoryId,
      content: body.content,
      stations: body.stations ?? [],
      status: body.status ?? "DRAFT",
      sortOrder: body.sortOrder ?? 0,
      createdById: session.id,
      publishedAt: body.status === "PUBLISHED" ? new Date() : null,
      expectedRecurrence: (body.expectedRecurrence as "SHIFT" | "SPECIFIC_TIMES" | "HOURLY") ?? "SHIFT",
      expectedTimesPerDay: body.expectedTimesPerDay ?? 1,
      expectedDueMinutes: body.expectedDueMinutes ?? 0,
      appliesToAllOutlets: body.appliesToAllOutlets ?? true,
    },
    include: {
      category: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(sop, { status: 201 });
}
