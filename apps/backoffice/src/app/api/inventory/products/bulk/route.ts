import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/products/bulk
 * Bulk update products. Accepts { ids: string[], data: { groupId?, storageArea?, checkFrequency? } }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { ids, data } = body as {
    ids: string[];
    data: { groupId?: string; storageArea?: string; checkFrequency?: string };
  };

  if (!ids?.length || !data) {
    return NextResponse.json({ error: "ids and data required" }, { status: 400 });
  }

  const updateData: Record<string, string> = {};
  if (data.groupId) updateData.groupId = data.groupId;
  if (data.storageArea) updateData.storageArea = data.storageArea;
  if (data.checkFrequency) updateData.checkFrequency = data.checkFrequency;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: updateData,
  });

  return NextResponse.json({ updated: result.count });
}

/**
 * DELETE /api/products/bulk
 * Bulk delete products. Accepts { ids: string[] }
 */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { ids } = body as { ids: string[] };

  if (!ids?.length) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const result = await prisma.product.deleteMany({
    where: { id: { in: ids } },
  });

  return NextResponse.json({ deleted: result.count });
}
