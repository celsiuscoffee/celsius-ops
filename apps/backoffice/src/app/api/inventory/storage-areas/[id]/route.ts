import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const { name } = await req.json();

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const area = await prisma.storageArea.update({
      where: { id },
      data: { name: name.trim(), slug },
    });

    return NextResponse.json(area);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "A storage area with that name already exists" }, { status: 409 });
    }
    console.error("[storage-areas/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(_req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;

    // Check if any products reference this storage area
    const area = await prisma.storageArea.findUnique({ where: { id } });
    if (!area) {
      return NextResponse.json({ error: "Storage area not found" }, { status: 404 });
    }

    const productCount = await prisma.product.count({
      where: { storageArea: area.name },
    });

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete: ${productCount} item${productCount > 1 ? "s" : ""} still assigned to this storage area` },
        { status: 409 }
      );
    }

    await prisma.storageArea.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[storage-areas/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
