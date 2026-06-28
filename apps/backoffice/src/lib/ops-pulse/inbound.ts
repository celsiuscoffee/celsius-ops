// Inbound-ack hook for the ops pulse, called from the WhatsApp webhook.
// When a manager/owner replies to a digest with an ack word ("DONE", "ok",
// "fixed"…), close their still-open alerts. Matching all of their open alerts
// is intentional — the digest batches a person's items, so one "DONE" clears
// the batch. Refine to per-item acks once template quick-reply buttons land.

import { prisma } from "@/lib/prisma";
import { resolveOpenAlertsForUser } from "./ledger";

const ACK = /\b(done|ok|okay|resolved|settled|fixed|cleared?|handled)\b/i;

function digits(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

// Inbound senders are international digits (e.g. 60123456789); stored phones may
// be +60…/01…. Compare the last 9 digits, which uniquely identify a MY mobile.
// Exported so the reminder + instruction ack handlers match the same way.
export function samePhone(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  const n = Math.min(9, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

// Strong completion words — "I finished it". Closes reminders/tasks. Excludes a
// bare "ok"/"okay" (too easily a throwaway reply to risk auto-completing a task).
export const ACK_STRONG = /\b(done|resolved|settled|fixed|cleared?|handled|completed?|siap|selesai)\b/i;
// Soft acknowledgement — "got it". Enough to ACK an instruction (low stakes), so
// it also accepts ok/okay/noted/received/baik on top of the strong words.
export const ACK_SOFT = /\b(done|ok|okay|noted|received|roger|acknowledged?|got\s*it|resolved|settled|fixed|cleared?|handled|completed?|siap|selesai|baik|faham)\b/i;

// Returns the number of alerts resolved, or null when the message wasn't an ack
// from a known manager/owner. Never throws — caller logs.
export async function handleInboundAck(from: string, text: string): Promise<{ resolved: number } | null> {
  if (!from || !ACK.test(text)) return null;

  const staff = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "OWNER"] }, status: "ACTIVE", phone: { not: null } },
    select: { id: true, phone: true },
  });
  const user = staff.find((u) => u.phone && samePhone(from, u.phone));
  if (!user) return null;

  const resolved = await resolveOpenAlertsForUser(user.id);
  return { resolved };
}
