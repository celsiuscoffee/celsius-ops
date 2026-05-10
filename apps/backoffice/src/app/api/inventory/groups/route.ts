import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
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
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { name } = await req.json();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const group = await prisma.itemGroup.create({
    data: { name, slug },
  });

  return NextResponse.json(group, { status: 201 });
}
