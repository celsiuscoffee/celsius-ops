import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const branch = await prisma.branch.update({
    where: { id },
    data: body,
  });

  return NextResponse.json(branch);
}
