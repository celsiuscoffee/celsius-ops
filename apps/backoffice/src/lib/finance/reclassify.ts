// One-shot re-classification of catch-all bank lines with the CURRENT rules.
//
// The feed sync re-classifies its own window on every rebuild, but PDF-era
// lines (before the feed anchor) keep whatever category they got at ingest —
// so rules added later (suppliers, dividends, Rentokil, card MDR…) never
// touch them and they sit in OTHER_OUTFLOW forever. This re-runs the
// classifier over the catch-all pile, updates what now classifies, and
// un-stamps the affected GL journals so the poster re-keys them under the
// corrected contra accounts on the next run.
//
// Human classifications (classifiedBy != 'rule') are never overwritten.

import { prisma } from "@/lib/prisma";
import { classifyBankLine } from "./bank-line-classifier";
import { supplierVendorHints } from "./bukku-feed-sync";
import { fetchLearnedHints } from "./category-hints";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReclassifyResult = {
  committed: boolean;
  scanned: number;
  changed: number;
  changedValue: number;
  unstampedJournals: number;
  byRule: { ruleName: string; category: string; n: number; amount: number }[];
};

export async function reclassifyBankLines(opts: { commit?: boolean; full?: boolean } = {}): Promise<ReclassifyResult> {
  const commit = opts.commit ?? false;
  // full=true widens the sweep to EVERY rule-classified line, not just the
  // OTHER_* pile — needed when a correction changes a category that a generic
  // rule got wrong (GET RENTAL sat in RENT, Mikofee's dividend in
  // RAW_MATERIALS; neither is in the catch-all pile). Still never touches
  // user classifications or AP-matched lines, and a line only changes when
  // the classifier gives a SPECIFIC answer (fallback never downgrades).
  const full = opts.full ?? false;
  const vendorHints = await supplierVendorHints();
  let learnedHints: Awaited<ReturnType<typeof fetchLearnedHints>> = [];
  try { learnedHints = await fetchLearnedHints(); } catch { /* hints are additive */ }

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      ...(full ? {} : { OR: [{ category: null }, { category: { in: ["OTHER_OUTFLOW", "OTHER_INFLOW"] } }] }),
      AND: [{ OR: [{ classifiedBy: null }, { classifiedBy: "rule" }] }],
      apInvoiceId: null,
    },
    select: {
      id: true, description: true, amount: true, direction: true, category: true,
      glTransactionId: true,
      statement: { select: { accountName: true } },
    },
  });

  type Change = { id: string; category: string; ruleName: string; isInterCo: boolean; amount: number; glTransactionId: string | null };
  const changes: Change[] = [];
  for (const l of lines) {
    const res = classifyBankLine({
      description: l.description ?? "",
      amount: Number(l.amount),
      direction: l.direction as "CR" | "DR",
      accountKey: l.statement.accountName ?? undefined,
      vendorHints,
      learnedHints,
    });
    if (!res.category || res.category === l.category) continue;
    if (res.category === "OTHER_OUTFLOW" || res.category === "OTHER_INFLOW") continue;
    changes.push({ id: l.id, category: res.category, ruleName: res.ruleName, isInterCo: res.isInterCo, amount: Number(l.amount), glTransactionId: l.glTransactionId });
  }

  const byRuleMap = new Map<string, { ruleName: string; category: string; n: number; amount: number }>();
  for (const c of changes) {
    const k = `${c.ruleName}|${c.category}`;
    const cur = byRuleMap.get(k) ?? { ruleName: c.ruleName, category: c.category, n: 0, amount: 0 };
    cur.n++; cur.amount = round2(cur.amount + c.amount);
    byRuleMap.set(k, cur);
  }

  // A changed line whose day-aggregate journal is posted re-keys under a new
  // contra — the WHOLE journal must rebuild (un-stamping only the changed line
  // would leave the old journal over-stated).
  const journalIds = [...new Set(changes.map((c) => c.glTransactionId).filter((x): x is string => !!x))];

  let unstampedJournals = 0;
  if (commit && changes.length) {
    // Batch category updates per (category, ruleName, isInterCo) triple.
    const batches = new Map<string, { data: { category: string; ruleName: string; isInterCo: boolean }; ids: string[] }>();
    for (const c of changes) {
      const k = `${c.category}|${c.ruleName}|${c.isInterCo}`;
      const b = batches.get(k);
      if (b) b.ids.push(c.id);
      else batches.set(k, { data: { category: c.category, ruleName: c.ruleName, isInterCo: c.isInterCo }, ids: [c.id] });
    }
    for (const b of batches.values()) {
      for (let i = 0; i < b.ids.length; i += 500) {
        await prisma.bankStatementLine.updateMany({
          where: { id: { in: b.ids.slice(i, i + 500) } },
          data: { category: b.data.category as never, ruleName: b.data.ruleName, isInterCo: b.data.isInterCo, classifiedBy: "rule" },
        });
      }
    }
    for (let i = 0; i < journalIds.length; i += 200) {
      const chunk = journalIds.slice(i, i + 200);
      await prisma.bankStatementLine.updateMany({
        where: { glTransactionId: { in: chunk } },
        data: { glTransactionId: null, glPostedAt: null },
      });
    }
    unstampedJournals = journalIds.length;
  } else {
    unstampedJournals = journalIds.length;
  }

  return {
    committed: commit,
    scanned: lines.length,
    changed: changes.length,
    changedValue: round2(changes.reduce((s, c) => s + c.amount, 0)),
    unstampedJournals,
    byRule: [...byRuleMap.values()].sort((a, b) => b.amount - a.amount),
  };
}
