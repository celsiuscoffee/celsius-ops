import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listThreads } from "@/lib/wa-messages";
import { countOpenAlerts } from "@/lib/ops-pulse/workspace";
import { countOpenReminders } from "@/lib/ops-reminders";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// Attention counts for the workspace segmented control. Inbox count is "threads
// awaiting a reply" (latest message inbound), not total threads.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const scope = { userId: session.id, role: session.role };
  const now = new Date();
  const [threads, pulseOpen, remindersOpen] = await Promise.all([
    listThreads(now),
    countOpenAlerts(scope),
    countOpenReminders(scope),
  ]);

  return NextResponse.json({
    inbox: { threads: threads.length, awaitingReply: threads.filter((t) => t.awaitingReply).length },
    pulse: { open: pulseOpen },
    reminders: { open: remindersOpen },
  });
}
