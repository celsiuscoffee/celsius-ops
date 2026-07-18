/**
 * POP-match correction memory — the self-improving half of the POP QA loop.
 *
 * The pop-verifier judges a POP at a matcher dead-end and stamps its verdict on the
 * target invoice's `flags` (code POP_VERIFIER). This module reads recent verdicts back,
 * compares them to what ACTUALLY happened to the invoice (did it end up PAID?), and
 * distils a short "what you've gotten wrong before" block that's prepended to the next
 * judge prompt — so the same supplier's quirk (delivery-charge gap, a shared corporate
 * account that reuses bank refs, an always-deposit supplier) stops re-breaking.
 *
 * SAFE by construction (mirrors agent-lessons.ts):
 *  - Gated (PROCUREMENT_POP_VERIFIER_LESSONS) for staged rollout.
 *  - Uses ONLY our own structured fields (payee name + enums + the resulting status) —
 *    never the raw POP text — so a crafted receipt can't smuggle instructions forward.
 *  - Bounded + deduped, most-recent first. Framed as reference, not orders.
 */
import { prisma } from "@/lib/prisma";

export function popLessonsEnabled(): boolean {
  // Default ON (2026-07-18, same owner call as agent-lessons in #895): the lessons
  // block is the "improves by itself" half of the POP QA loop and it only feeds the
  // judge prompt — it never moves money. Set PROCUREMENT_POP_VERIFIER_LESSONS=false
  // to disable for debugging.
  return process.env.PROCUREMENT_POP_VERIFIER_LESSONS !== "false";
}

type PopVerifierFlag = {
  code?: string;
  meta?: {
    scenario?: string; // "no_match" | "duplicate_blocked"
    decision?: string; // "pay" | "propose" | "no_action"
    payee?: string;
    isGenuineDuplicate?: boolean;
  };
};

const PAID = new Set(["PAID", "DEPOSIT_PAID", "PARTIALLY_PAID"]);

/**
 * A compact "lessons from past POP matches" block. Two signals:
 *  (a) the judge said propose/no_action but the invoice is now PAID → it was too cautious;
 *      learn to recognise that payee's real payment next time.
 *  (b) a duplicate-blocked POP judged a DISTINCT payment that then paid → that payee/account
 *      reuses bank references; don't treat a repeated ref as a re-send.
 * Returns "" when disabled / nothing to learn.
 */
export async function recentPopLessons(limit = 6): Promise<string> {
  if (!popLessonsEnabled()) return "";

  // Recent invoices, newest first; filter in JS for a POP_VERIFIER flag (robust against
  // nested-JSON query filters). POPs are almost always for recent invoices.
  const rows = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { status: true, flags: true, supplier: { select: { name: true } }, vendorName: true },
  });

  const seenMiss = new Set<string>();
  const misses: string[] = [];
  const seenDup = new Set<string>();
  const dups: string[] = [];

  for (const r of rows) {
    const flags = Array.isArray(r.flags) ? (r.flags as unknown as PopVerifierFlag[]) : [];
    const vf = flags.find((f) => f && f.code === "POP_VERIFIER")?.meta;
    if (!vf) continue;
    const payee = vf.payee || r.supplier?.name || r.vendorName || "a supplier";
    const paid = PAID.has(r.status);

    // (a) judge under-called but the payment was real
    if (paid && (vf.decision === "propose" || vf.decision === "no_action") && misses.length < limit) {
      const key = `${payee}::${vf.scenario}`;
      if (!seenMiss.has(key)) {
        seenMiss.add(key);
        misses.push(`- ${payee}: a POP the matcher dropped (${vf.scenario}) turned out to be a real payment — recognise this one.`);
      }
    }

    // (b) a repeated bank ref that was actually a distinct payment
    if (paid && vf.scenario === "duplicate_blocked" && vf.isGenuineDuplicate === false && dups.length < limit) {
      const key = `${payee}::dup`;
      if (!seenDup.has(key)) {
        seenDup.add(key);
        dups.push(`- ${payee}: a reused bank reference was a DISTINCT payment, not a re-send — don't block on the ref alone.`);
      }
    }
  }

  // (c) How a human resolved past AMBIGUOUS POPs (the tap-to-pick keyboard /
  //     backoffice confirm). The picker is the third dead-end the judge never
  //     sees at decision time — but its resolutions are ground truth for which
  //     sibling a payee's identical-amount payments actually settle. Uses only
  //     our own structured fields (supplier name, invoice number, outlet code).
  const seenPick = new Set<string>();
  const picks: string[] = [];
  try {
    const resolved = await prisma.pendingPop.findMany({
      where: { resolvedInvoiceId: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 30,
      select: { amount: true, resolvedInvoiceId: true },
    });
    if (resolved.length > 0) {
      const invs = await prisma.invoice.findMany({
        where: { id: { in: resolved.map((r) => r.resolvedInvoiceId!) } },
        select: {
          id: true,
          invoiceNumber: true,
          supplier: { select: { name: true } },
          vendorName: true,
          outlet: { select: { code: true } },
        },
      });
      const byId = new Map(invs.map((i) => [i.id, i]));
      for (const r of resolved) {
        if (picks.length >= limit) break;
        const inv = byId.get(r.resolvedInvoiceId!);
        if (!inv) continue;
        const payee = inv.supplier?.name ?? inv.vendorName ?? "a payee";
        const key = `${payee}::${Number(r.amount).toFixed(2)}`;
        if (seenPick.has(key)) continue;
        seenPick.add(key);
        picks.push(
          `- ${payee} RM ${Number(r.amount).toFixed(2)}: finance resolved the ambiguity to ${inv.invoiceNumber}${
            inv.outlet?.code ? ` (${inv.outlet.code})` : ""
          }.`,
        );
      }
    }
  } catch {
    // lessons are best-effort — never block the judge on a read failure
  }

  if (misses.length === 0 && dups.length === 0 && picks.length === 0) return "";

  let block = "";
  if (misses.length) {
    block += `\n# Real payments the matcher has dropped before (reference only — still verify amount + payee)\n${misses.join("\n")}\n`;
  }
  if (dups.length) {
    block += `\n# Bank references that have repeated across DISTINCT payments (don't read a repeat as a re-send)\n${dups.join("\n")}\n`;
  }
  if (picks.length) {
    block += `\n# How finance resolved past ambiguous same-amount POPs (learn the payee's pattern; still verify)\n${picks.join("\n")}\n`;
  }
  return block;
}
