import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOpenAlerts } from "@/lib/ops-pulse/workspace";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET — open/escalated ops-pulse alerts. OWNER/ADMIN see all; MANAGER sees their own.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const alerts = await listOpenAlerts({ userId: session.id, role: session.role });
  return NextResponse.json({ alerts });
}
