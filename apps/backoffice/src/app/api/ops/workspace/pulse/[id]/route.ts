import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getAlertAssignee, resolveAlert, ackAlert } from "@/lib/ops-pulse/workspace";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];
const schema = z.object({ action: z.enum(["resolve", "ack"]) });

// POST — resolve (close) or ack (mark seen) one alert. Non-admins may only act
// on alerts routed to them; OWNER/ADMIN on any.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: { action: "resolve" | "ack" };
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const alert = await getAlertAssignee(id);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && alert.assigneeUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.action === "resolve") await resolveAlert(id);
  else await ackAlert(id);
  return NextResponse.json({ ok: true });
}
