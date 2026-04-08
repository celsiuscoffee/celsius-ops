import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller || (caller.role !== "ADMIN" && caller.role !== "OWNER")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, ruleType, condition, threshold, outlets, approverIds, isActive } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (ruleType !== undefined) data.ruleType = ruleType;
  if (condition !== undefined) data.condition = condition;
  if (threshold !== undefined) data.threshold = threshold;
  if (outlets !== undefined) data.outlets = outlets;
  if (approverIds !== undefined) data.approverIds = approverIds;
  if (isActive !== undefined) data.isActive = isActive;

  const rule = await prisma.approvalRule.update({ where: { id }, data });
  return NextResponse.json(rule);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller || (caller.role !== "ADMIN" && caller.role !== "OWNER")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.approvalRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
