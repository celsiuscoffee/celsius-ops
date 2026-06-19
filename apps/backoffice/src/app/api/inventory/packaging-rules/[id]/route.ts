import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

const SCOPES = ["ALL", "CATEGORY", "ITEMS"] as const;
const CHANNELS = ["ALL", "DINE_IN", "TAKEAWAY", "GRAB", "DELIVERY"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  if (body.productId) data.productId = body.productId;
  if (body.quantity != null) data.quantity = Number(body.quantity);
  if (body.scope && SCOPES.includes(body.scope)) {
    data.scope = body.scope;
    // Keep scope-specific fields consistent with the chosen scope.
    data.category = body.scope === "CATEGORY" ? body.category || null : null;
    data.menuIds = body.scope === "ITEMS" && Array.isArray(body.menuIds) ? body.menuIds : [];
  } else {
    if (body.category !== undefined) data.category = body.category || null;
    if (Array.isArray(body.menuIds)) data.menuIds = body.menuIds;
  }
  if (body.channel && CHANNELS.includes(body.channel)) data.channel = body.channel;
  if (body.perOrder !== undefined) data.perOrder = !!body.perOrder;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.notes !== undefined) data.notes = body.notes || null;

  const rule = await prisma.packagingRule.update({ where: { id }, data });
  return NextResponse.json(rule);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  await prisma.packagingRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
