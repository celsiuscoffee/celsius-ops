import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const areas = await prisma.storageArea.findMany({
    orderBy: { name: "asc" },
  });

  // Count products per storage area
  const products = await prisma.product.groupBy({
    by: ["storageArea"],
    _count: { id: true },
    where: { storageArea: { not: null } },
  });

  const countMap = new Map(products.map((p) => [p.storageArea, p._count.id]));

  const mapped = areas.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    productCount: countMap.get(a.name) || 0,
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { name } = await req.json();
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  try {
    const area = await prisma.storageArea.create({
      data: { name: name.trim(), slug },
    });
    return NextResponse.json(area, { status: 201 });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "A storage area with that name already exists" }, { status: 409 });
    }
    console.error("[storage-areas POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
