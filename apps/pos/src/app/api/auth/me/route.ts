import { NextResponse } from "next/server";
import { getSession } from "@celsius/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({
    id: session.id,
    name: session.name,
    role: session.role,
    outletId: session.outletId,
    outletName: session.outletName,
  });
}
