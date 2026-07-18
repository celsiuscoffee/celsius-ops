import { createHash } from "crypto";
import { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { resolveOwner } from "@/lib/ops-pulse/router";
import { sendList } from "@/lib/ops-pulse/sender";
import { TEMPLATES } from "@/lib/ops-pulse/config";

// ─── Procurement-loop watchdog ─────────────────────────────────────────────
//
// The loop's vital-signs monitor — the answer to "is the loop improving by
// itself?". Every component fails politely into console.log, which nobody
// reads: the Vercel cron cap silently killed the exec for 10 days, the PDF
// template failed 16×/16 and two cold-prompted POs sat undelivered for 4 days
// before a manual QA sweep noticed any of it. This turns those classes of
// silent failure into ONE WhatsApp digest to the owner within a run cycle.
//
// Checks are DB-only (observable outcomes, not logs) and deliberately cheap:
//   1. stale pars           — an outlet's engine pars older than 8 days
//   2. stuck cold prompts   — prompted >48h, never delivered, PO still open
//   3. dead send channel    — a channel with ≥3 sends and ZERO successes in 24h
//   4. stale escalations    — actionable proposals unresolved >24h
//   5. stale draft invoices — AI captures unapproved >48h
//   6. run failures         — jobs that threw in this dispatcher run
//
// Deduped by findings-fingerprint: the same set of problems is re-sent at most
// once every 24h (a NEW problem re-alerts immediately). Sends via the ops-pulse
// owner channel (approved templates, window-safe, push-mirrored). Never throws.

const OPEN_PO_STATUSES = ["APPROVED", "SENT", "CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"] as const;

export interface WatchdogResult {
  findings: string[];
  alerted: boolean;
  skipped?: "no-findings" | "deduped" | "no-owner";
}

export async function runLoopWatchdog(opts: { runFailures?: string[] } = {}): Promise<WatchdogResult> {
  const findings: string[] = [...(opts.runFailures ?? [])];
  const now = Date.now();
  const DAY = 86_400_000;

  // 1. Stale pars — the engine promises weekly recalc; >8d means the cron died.
  try {
    const outlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE", loyaltyOutletId: { not: null } },
      select: { id: true, name: true },
    });
    for (const o of outlets) {
      const latest = await prisma.parLevel.aggregate({ where: { outletId: o.id }, _max: { lastCalculated: true } });
      const last = latest._max.lastCalculated;
      if (!last || now - +last > 8 * DAY) {
        findings.push(`Pars stale at ${o.name} (last calc ${last ? last.toISOString().slice(0, 10) : "never"})`);
      }
    }
  } catch (e) {
    console.warn("[loop-watchdog] pars check failed:", e instanceof Error ? e.message : e);
  }

  // 2. Cold-prompted POs never delivered (>48h) — the prompt dead-air trap.
  try {
    const since = new Date(now - 14 * DAY);
    const [prompted, delivered] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where: { direction: "outbound", timestamp: { gte: since }, AND: [{ raw: { path: ["poPromptFor"], not: Prisma.DbNull } }, { raw: { path: ["ok"], equals: true } }] },
        select: { raw: true, timestamp: true },
      }),
      prisma.whatsAppMessage.findMany({
        where: { direction: "outbound", timestamp: { gte: since }, AND: [{ raw: { path: ["poSentFor"], not: Prisma.DbNull } }, { raw: { path: ["ok"], equals: true } }] },
        select: { raw: true },
      }),
    ]);
    const sentIds = new Set(delivered.map((m) => String((m.raw as Record<string, unknown>)?.poSentFor ?? "")));
    const stale = new Map<string, Date>();
    for (const m of prompted) {
      const id = String((m.raw as Record<string, unknown>)?.poPromptFor ?? "");
      if (!id || sentIds.has(id)) continue;
      const prev = stale.get(id);
      if (!prev || m.timestamp > prev) stale.set(id, m.timestamp); // newest prompt per PO
    }
    const staleIds = [...stale.entries()].filter(([, t]) => now - +t > 2 * DAY).map(([id]) => id);
    if (staleIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: { id: { in: staleIds }, status: { in: [...OPEN_PO_STATUSES] } },
        select: { orderNumber: true, supplier: { select: { name: true } } },
      });
      for (const o of orders) {
        findings.push(`PO ${o.orderNumber} (${o.supplier?.name ?? "?"}) cold-prompted >48h, supplier never replied — send manually`);
      }
    }
  } catch (e) {
    console.warn("[loop-watchdog] prompt check failed:", e instanceof Error ? e.message : e);
  }

  // 3. Dead send channel — 100% failure over the last 24h means a broken
  // template/token, not a flaky supplier (would have caught the PDF template
  // failing 16/16 on day one).
  try {
    const since = new Date(now - DAY);
    const rows = await prisma.whatsAppMessage.findMany({
      where: { direction: "outbound", timestamp: { gte: since }, status: { in: ["sent", "failed"] } },
      select: { status: true, raw: true },
    });
    const byChannel = new Map<string, { total: number; ok: number }>();
    for (const r of rows) {
      const raw = r.raw as Record<string, unknown> | null;
      const via = typeof raw?.via === "string" ? raw.via : null;
      if (!via) continue;
      const c = byChannel.get(via) ?? { total: 0, ok: 0 };
      c.total++;
      if (raw?.ok === true) c.ok++;
      byChannel.set(via, c);
    }
    for (const [via, c] of byChannel) {
      if (c.total >= 3 && c.ok === 0) findings.push(`Send channel "${via}" failing 100% (${c.total} sends, 0 delivered, 24h)`);
    }
  } catch (e) {
    console.warn("[loop-watchdog] channel check failed:", e instanceof Error ? e.message : e);
  }

  // 4. Actionable escalations unresolved >24h — the ASSIST handoff stalling.
  try {
    const rows = await prisma.whatsAppMessage.findMany({
      where: {
        direction: "outbound",
        timestamp: { gte: new Date(now - 14 * DAY), lte: new Date(now - DAY) },
        raw: { path: ["escalated"], equals: true },
      },
      select: { raw: true, supplierId: true },
    });
    let stale = 0;
    const supplierIds = new Set<string>();
    for (const m of rows) {
      const raw = m.raw as Record<string, unknown>;
      if (raw.proposalResolved === true) continue;
      const p = raw.proposal as { poAction?: { type?: string } | null; invoiceAction?: unknown } | undefined;
      const actionable = (p?.poAction?.type && p.poAction.type !== "none") || !!p?.invoiceAction;
      if (!actionable) continue;
      stale++;
      if (m.supplierId) supplierIds.add(m.supplierId);
    }
    if (stale > 0) {
      const sups = await prisma.supplier.findMany({
        where: { id: { in: [...supplierIds].slice(0, 3) } },
        select: { name: true },
      });
      const names = sups.map((s) => s.name).join(", ");
      findings.push(`${stale} supplier proposal(s) awaiting approval >24h${names ? ` (${names})` : ""} — Supplier Chats › Needs attention`);
    }
  } catch (e) {
    console.warn("[loop-watchdog] proposals check failed:", e instanceof Error ? e.message : e);
  }

  // 5. AI-captured invoices stuck in DRAFT >48h — unverified payables ageing.
  try {
    const drafts = await prisma.invoice.count({
      where: { status: "DRAFT", createdAt: { lt: new Date(now - 2 * DAY) } },
    });
    if (drafts > 0) findings.push(`${drafts} captured invoice(s) unapproved >48h — approve or delete in Invoices`);
  } catch (e) {
    console.warn("[loop-watchdog] drafts check failed:", e instanceof Error ? e.message : e);
  }

  // 6. Ambiguous POPs nobody resolved >24h — a real bank transfer sits attached
  // to NO invoice, so the invoice still reads unpaid (double-pay risk) and the
  // matcher gets no ground truth to learn from. Tap-to-pick in Telegram or
  // confirm in Invoices; either closes it. (Found live: 6/6 pickers untapped.)
  try {
    const stalePops = await prisma.pendingPop.findMany({
      where: { resolvedInvoiceId: null, createdAt: { lt: new Date(now - DAY) } },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (stalePops.length > 0) {
      const total = stalePops.reduce((s, p) => s + Number(p.amount), 0);
      const oldestDays = Math.floor((now - stalePops[0].createdAt.getTime()) / DAY);
      findings.push(
        `${stalePops.length} POP(s) (RM ${total.toFixed(2)}) awaiting a match pick >24h (oldest ${oldestDays}d) — tap the Telegram picker or confirm in Invoices, else double-pay risk`,
      );
    }
  } catch (e) {
    console.warn("[loop-watchdog] pending-pop check failed:", e instanceof Error ? e.message : e);
  }

  if (findings.length === 0) return { findings, alerted: false, skipped: "no-findings" };

  // Dedupe: identical findings-set → at most one alert per 24h. A changed set
  // (new problem, or one fixed) alerts immediately.
  const key = createHash("sha1").update(findings.slice().sort().join("|")).digest("hex").slice(0, 16);
  try {
    const recent = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        timestamp: { gte: new Date(now - DAY) },
        AND: [{ raw: { path: ["watchdog"], equals: true } }, { raw: { path: ["findingsKey"], equals: key } }],
      },
      select: { id: true },
    });
    if (recent) return { findings, alerted: false, skipped: "deduped" };
  } catch {
    /* dedupe is best-effort */
  }

  const owner = await resolveOwner();
  if (!owner?.phone) {
    console.warn("[loop-watchdog] findings but no ACTIVE OWNER with a phone:", findings);
    return { findings, alerted: false, skipped: "no-owner" };
  }

  const res = await sendList(owner.phone, `Procurement loop check — ${findings.length} issue(s)`, findings, TEMPLATES.ownerEscalation);
  // Stamp the fingerprint on our own outbound record for the dedupe window.
  // sendList already recorded the message; add a marker row only if the send
  // path didn't record (fallback template path records inside sendProactive).
  try {
    const last = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", toNumber: owner.phone.replace(/\D/g, "") },
      orderBy: { timestamp: "desc" },
      select: { id: true, raw: true },
    });
    if (last) {
      await prisma.whatsAppMessage.update({
        where: { id: last.id },
        data: { raw: { ...((last.raw as Record<string, unknown>) ?? {}), watchdog: true, findingsKey: key } },
      });
    }
  } catch {
    /* marker is best-effort; worst case we re-alert in 24h */
  }
  console.log(`[loop-watchdog] ${findings.length} finding(s), alerted=${res.ok}`);
  return { findings, alerted: res.ok };
}
