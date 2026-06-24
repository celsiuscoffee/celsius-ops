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
function samePhone(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  const n = Math.min(9, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

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
