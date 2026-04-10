import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const groups = await prisma.itemGroup.findMany({
    include: {
      _count: { select: { products: true } },
    },
    orderBy: { name: "asc" },
  });

  const mapped = groups.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    productCount: g._count.products,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const group = await prisma.itemGroup.create({
    data: { name, slug },
  });

  return NextResponse.json(group, { status: 201 });
}
