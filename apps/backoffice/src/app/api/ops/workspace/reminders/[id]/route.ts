import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getReminderOwners, updateReminder } from "@/lib/ops-reminders";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];
const schema = z.object({
  action: z.enum(["done", "snooze", "reopen", "cancel"]),
  snoozedUntil: z.string().datetime().optional().nullable(),
});

// PATCH — done / snooze / reopen / cancel a reminder. Non-admins may only act on
// reminders they created or were assigned.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const owners = await getReminderOwners(id);
  if (!owners) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && owners.createdByUserId !== session.id && owners.assigneeUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await updateReminder(id, body.action, session.id, body.snoozedUntil ? new Date(body.snoozedUntil) : null);
  return NextResponse.json({ ok: true });
}
