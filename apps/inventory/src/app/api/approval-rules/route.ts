import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET() {
  const rules = await prisma.approvalRule.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Resolve outlet names and approver names
  const outletIds = [...new Set(rules.flatMap((r) => r.outlets))];
  const approverIds = [...new Set(rules.flatMap((r) => r.approverIds))];

  const [outlets, approvers] = await Promise.all([
    outletIds.length > 0
      ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : [],
    approverIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
      : [],
  ]);

  const outletMap = Object.fromEntries(outlets.map((b) => [b.id, b.name]));
  const approverMap = Object.fromEntries(approvers.map((a) => [a.id, a.name]));

  const mapped = rules.map((r) => ({
    id: r.id,
    name: r.name,
    ruleType: r.ruleType,
    condition: r.condition,
    threshold: r.threshold ? Number(r.threshold) : null,
    outlets: r.outlets.map((id) => ({ id, name: outletMap[id] || id })),
    approvers: r.approverIds.map((id) => ({ id, name: approverMap[id] || id })),
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller || (caller.role !== "ADMIN" && caller.role !== "OWNER")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json();
  const { name, ruleType, condition, threshold, outlets, approverIds, isActive } = body;

  if (!name || !ruleType || !condition) {
    return NextResponse.json({ error: "name, ruleType, and condition are required" }, { status: 400 });
  }

  const rule = await prisma.approvalRule.create({
    data: {
      name,
      ruleType,
      condition,
      threshold: threshold ?? null,
      outlets: outlets || [],
      approverIds: approverIds || [],
      isActive: isActive !== false,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
