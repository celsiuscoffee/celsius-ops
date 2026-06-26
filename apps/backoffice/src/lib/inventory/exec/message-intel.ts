/**
 * Inbound supplier-message intelligence (Inc 5) — the decoupled reader that turns
 * what suppliers SAY into procurement STATE, without touching the chat agent (the
 * mouth). It classifies recent inbound supplier messages and acts:
 *   - delivery promise ("esok hantar", "Tuesday", "22/6") → parse the date → set the
 *     matching open PO's deliveryDate, so overdue detection + ETA become real
 *   - SOA / statement → surface for finance reconciliation (payment is SOA-based)
 *   - price increase → flag COGS impact
 *   - invoice-change / troubleshoot / vendor-push → classify + count for the brief
 *
 * Read-mostly + safe: classification + a raw.intel annotation (for dedup) are always
 * written; the only Order write (deliveryDate) is OFF unless PROCUREMENT_EXEC_APPLY_ETA
 * =true, and only when the supplier has exactly one open PO (unambiguous). Gated by
 * PROCUREMENT_AGENT_ENABLED. Never throws. See docs/design/procurement-supplier-chat-intelligence.md.
 */
import type { OrderStatus, Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;
const AWAITING_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY"];

const RX = {
  delivery: /\b(otw|on the way|dalam perjalanan|sampai|arrived|delay|lambat|esok|tomorrow|tmrw?|besok|lusa|hari ni|hari ini|today|driver|lori|reschedule|ready|siap|deliver|hantar)\b/i,
  soa: /\b(soa|statement of account|statement|reflect at .* statement|outstanding|pending payment)\b/i,
  price: /\b(price (increase|increment|change|adjust|naik)|naik harga|harga baru|new price|increase this month)\b/i,
  invchange: /\b(revise|revised|credit note|\bcn\b|new invoice|invoice baru|betulkan invo|salah invo|invois salah|exchange and issue)\b/i,
  trouble: /\b(rosak|salah hantar|salah barang|kurang \d|short(age| paid| by)?|missing|tertinggal|pulangkan|tukar barang|ganti(kan)?|reject|expired|basi|pecah|bocor|defect|wrong (item|order)|broken|damaged)\b/i,
  vendorpush: /\b(any order|prepare.*order|order for this week|order this week|any stock needed|nak order|need anything|order missing)\b/i,
};

export type IntelCategory =
  | "delivery"
  | "soa"
  | "price"
  | "invchange"
  | "trouble"
  | "vendorpush"
  | "other";

export function classifyMessage(text: string): IntelCategory {
  // Order matters: most specific / actionable first.
  if (RX.trouble.test(text)) return "trouble";
  if (RX.soa.test(text)) return "soa";
  if (RX.price.test(text)) return "price";
  if (RX.invchange.test(text)) return "invchange";
  if (RX.vendorpush.test(text)) return "vendorpush";
  if (RX.delivery.test(text)) return "delivery";
  return "other";
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS: Record<string, number> = {
  sunday: 0, ahad: 0, monday: 1, isnin: 1, tuesday: 2, selasa: 2, wednesday: 3, rabu: 3,
  thursday: 4, khamis: 4, friday: 5, jumaat: 5, saturday: 6, sabtu: 6,
};

/**
 * Parse a promised delivery date from a message, relative to when it was sent.
 * Conservative — only high-confidence forms. `now` = the message timestamp.
 */
export function parsePromisedDate(text: string, now: Date): { date: Date; label: string } | null {
  const t = text.toLowerCase();
  const at12 = (d: Date) => {
    d.setHours(12, 0, 0, 0);
    return d;
  };
  if (/\b(hari ni|hari ini|today|petang ni|pagi ni|malam ni)\b/.test(t)) return { date: at12(new Date(now)), label: "today" };
  if (/\b(esok|tomorrow|tmrw|tmr|besok)\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: at12(d), label: "tomorrow" };
  }
  if (/\b(lusa|day after tomorrow)\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return { date: at12(d), label: "lusa" };
  }
  // DD/MM (slash only — a hyphen like "11-12" is usually a time range, not a date)
  let m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const dd = +m[1];
    const mm = +m[2] - 1;
    let yy = m[3] ? +m[3] : now.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 0 && mm <= 11) {
      const d = new Date(yy, mm, dd);
      if (!m[3] && d.getTime() < now.getTime() - DAY) d.setFullYear(yy + 1); // bare date in the past → next year
      return { date: at12(d), label: `${dd}/${mm + 1}` };
    }
  }
  // DD Mon (17th Jan, 22 June)
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (m) {
    const dd = +m[1];
    const mm = MONTHS[m[2]];
    const d = new Date(now.getFullYear(), mm, dd);
    if (d.getTime() < now.getTime() - DAY) d.setFullYear(now.getFullYear() + 1);
    return { date: at12(d), label: `${dd} ${m[2]}` };
  }
  // weekday → next occurrence
  for (const [w, idx] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const d = new Date(now);
      const diff = (idx - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return { date: at12(d), label: w };
    }
  }
  return null;
}

export interface IntelSummary {
  scanned: number;
  etaUpdates: string[]; // "PO-x → tomorrow"
  soa: number;
  priceIncrease: number;
  issues: number;
  vendorPush: number;
  invChange: number;
  skipped?: string;
}

const EMPTY: IntelSummary = { scanned: 0, etaUpdates: [], soa: 0, priceIncrease: 0, issues: 0, vendorPush: 0, invChange: 0 };

export async function runMessageIntel(): Promise<IntelSummary> {
  if (process.env.PROCUREMENT_AGENT_ENABLED !== "true") return { ...EMPTY, skipped: "disabled" };
  const applyEta = process.env.PROCUREMENT_EXEC_APPLY_ETA === "true";

  const since = new Date(Date.now() - 7 * DAY);
  const msgs = await prisma.whatsAppMessage.findMany({
    where: { direction: "inbound", supplierId: { not: null }, timestamp: { gte: since }, body: { not: null } },
    orderBy: { timestamp: "asc" },
    select: { id: true, supplierId: true, body: true, timestamp: true, raw: true },
    take: 1000,
  });

  const out: IntelSummary = { ...EMPTY, etaUpdates: [] };
  for (const m of msgs) {
    const raw = (m.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (raw.intel) continue; // already processed
    out.scanned++;
    const body = m.body ?? "";
    const category = classifyMessage(body);
    const intel: Record<string, unknown> = { category };

    if (category === "delivery") {
      const promised = parsePromisedDate(body, new Date(m.timestamp));
      if (promised) {
        intel.promisedDate = promised.date.toISOString().slice(0, 10);
        const open = await prisma.order.findMany({
          where: { supplierId: m.supplierId!, orderType: "PURCHASE_ORDER", status: { in: AWAITING_STATUSES } },
          orderBy: { createdAt: "desc" },
          take: 2,
          select: { id: true, orderNumber: true },
        });
        if (open.length === 1) {
          intel.matchedOrder = open[0].orderNumber;
          if (applyEta) {
            await prisma.order.update({ where: { id: open[0].id }, data: { deliveryDate: promised.date } });
            intel.appliedEta = true;
          }
          out.etaUpdates.push(`${open[0].orderNumber} → ${promised.label}${applyEta ? "" : " (preview)"}`);
        }
      }
    } else if (category === "soa") out.soa++;
    else if (category === "price") out.priceIncrease++;
    else if (category === "trouble") out.issues++;
    else if (category === "vendorpush") out.vendorPush++;
    else if (category === "invchange") out.invChange++;

    await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { raw: { ...raw, intel } as Prisma.InputJsonValue } });
  }
  return out;
}
