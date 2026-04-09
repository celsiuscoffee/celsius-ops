import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { z } from "zod";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.sopCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { sops: true } } },
  });

  return NextResponse.json(categories);
}

const createSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
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

  const slug = body.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await prisma.sopCategory.findFirst({
    where: { OR: [{ name: body.name }, { slug }] },
  });
  if (existing) {
    return NextResponse.json({ error: "Category name already exists" }, { status: 409 });
  }

  const category = await prisma.sopCategory.create({
    data: {
      name: body.name,
      slug,
      description: body.description,
      sortOrder: body.sortOrder ?? 0,
    },
  });

  return NextResponse.json(category, { status: 201 });
}
