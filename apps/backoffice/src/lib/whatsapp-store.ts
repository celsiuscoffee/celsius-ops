/**
 * Persistence for the WhatsApp supplier-chat monitor/inbox (Option 1).
 *
 * Every inbound (webhook) and outbound (our sends) message is written to the
 * WhatsAppMessage table so the team can monitor all supplier threads, a
 * BackOffice inbox can render them, and the AI can learn from / act on the
 * stream. Best-effort: persistence must NEVER break message handling.
 *
 * supplierId is a SOFT match on Supplier.phone (last 8 significant digits) —
 * null when there's no match; supplier numbers aren't guaranteed clean/unique.
 */
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

async function matchSupplierIdByPhone(phone: string): Promise<string | null> {
  const d = digits(phone);
  if (d.length < 8) return null;
  // Supplier set is small — pull those with a phone and compare normalized
  // digits. Matching the last 8 digits handles 60xxxxxxxxx vs 01xxxxxxxx vs
  // 0xxxxxxxx storage variants without a fragile SQL normalize.
  const suppliers = await prisma.supplier.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  const tail = d.slice(-8);
  const hit = suppliers.find((s) => {
    const sd = digits(s.phone);
    return sd === d || (sd.length >= 8 && sd.slice(-8) === tail);
  });
  return hit?.id ?? null;
}

export interface InboundRecord {
  waMessageId?: string;
  fromNumber: string;
  toNumber: string;
  type?: string;
  body?: string | null;
  mediaUrl?: string | null;
  timestamp?: Date;
  raw?: unknown;
}

// Returns true if the inbound was NEWLY stored, false if it was a duplicate (same wamid,
// a Meta re-delivery). Because waMessageId is @unique, the create is an ATOMIC claim — two
// concurrent re-deliveries can't both return true — so the webhook can run the agent exactly
// once per inbound off this flag (prevents the double-act race).
export async function recordInboundMessage(rec: InboundRecord): Promise<boolean> {
  try {
    const supplierId = await matchSupplierIdByPhone(rec.fromNumber);
    await prisma.whatsAppMessage.create({
      data: {
        waMessageId: rec.waMessageId ?? null,
        direction: "inbound",
        fromNumber: digits(rec.fromNumber),
        toNumber: digits(rec.toNumber),
        supplierId,
        type: rec.type ?? "text",
        body: rec.body ?? null,
        mediaUrl: rec.mediaUrl ?? null,
        timestamp: rec.timestamp ?? new Date(),
        raw: (rec.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return true; // newly stored
  } catch (e) {
    // P2002 = duplicate wamid (re-delivery) → not new. Any OTHER write error → fail-open
    // (treat as new so a transient DB error doesn't silently drop the message). Never throws.
    const dup = (e as { code?: string }).code === "P2002";
    if (!dup) console.warn(`[whatsapp:store] inbound persist skipped: ${e instanceof Error ? e.message : e}`);
    return !dup;
  }
}

export interface OutboundRecord {
  waMessageId?: string;
  fromNumber: string;
  toNumber: string;
  type?: string;
  body?: string | null;
  mediaUrl?: string | null;
  supplierId?: string | null;
  status?: string | null;
  // Free-form audit payload stored on the row. The supplier-chat agent stamps
  // its decision + the inbound waMessageId it answers ({ agent, inReplyTo, … })
  // here, so the inbox can show "AI replied" and redeliveries are de-duped.
  raw?: unknown;
}

export async function recordOutboundMessage(rec: OutboundRecord): Promise<string | null> {
  try {
    const created = await prisma.whatsAppMessage.create({
      data: {
        waMessageId: rec.waMessageId ?? null,
        direction: "outbound",
        fromNumber: digits(rec.fromNumber),
        toNumber: digits(rec.toNumber),
        supplierId: rec.supplierId ?? (await matchSupplierIdByPhone(rec.toNumber)),
        type: rec.type ?? "text",
        body: rec.body ?? null,
        mediaUrl: rec.mediaUrl ?? null,
        status: rec.status ?? "sent",
        raw: (rec.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    console.warn(`[whatsapp:store] outbound persist skipped: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
