import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { listReminders, createReminder } from "@/lib/ops-reminders";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET — ad-hoc reminders (scoped) + active staff for the assignee picker + HR
// "reminder" memos surfaced read-only.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const includeDone = new URL(req.url).searchParams.get("done") === "1";
  const scope = { userId: session.id, role: session.role };

  const [reminders, assignees, memos] = await Promise.all([
    listReminders(scope, includeDone),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, fullName: true, role: true },
      orderBy: { name: "asc" },
    }),
    fetchReminderMemos(),
  ]);

  return NextResponse.json({
    reminders,
    assignees: assignees.map((u) => ({ id: u.id, name: u.fullName || u.name, role: u.role })),
    memos,
  });
}

// HR "reminder" memos live in the separate HR DB. Surfaced read-only here (acks
// happen in the HR module). Best-effort — never fail the workspace if HR is
// unreachable.
async function fetchReminderMemos() {
  try {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_memos")
      .select("id,title,body,severity,issued_at,user_ids,status")
      .eq("type", "reminder")
      .eq("status", "active")
      .order("issued_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];

    const uids = Array.from(new Set(data.flatMap((m) => m.user_ids || []).filter(Boolean) as string[]));
    const users = uids.length
      ? await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, fullName: true } })
      : [];
    const nameOf = (id: string) => users.find((u) => u.id === id)?.fullName || users.find((u) => u.id === id)?.name || id;

    return data.map((m) => ({
      id: m.id as string,
      title: m.title as string,
      body: m.body as string,
      severity: m.severity as string,
      issuedAt: m.issued_at as string,
      recipients: ((m.user_ids as string[] | null) || []).map(nameOf),
    }));
  } catch {
    return [];
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
});

// POST — create an ad-hoc reminder.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const r = await createReminder({
    title: body.title,
    notes: body.notes ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    assigneeUserId: body.assigneeUserId ?? null,
    createdByUserId: session.id,
  });
  return NextResponse.json({ ok: true, id: r.id });
}
