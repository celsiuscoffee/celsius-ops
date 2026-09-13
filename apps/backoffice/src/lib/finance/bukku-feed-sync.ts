// Live bank-ledger sync from Bukku's raw Maybank feed.
//
// For every company with Bukku creds, for each linked bank-feed account:
//   anchor  = latest verified PDF BankStatement (closingBalance @ periodEnd)
//   forward = raw feed lines with txnDate > anchor
//   rebuild = monthly BankStatement rows, closingBalance = anchor + cum net
//
// Feed net per month == Maybank PDF net to the cent (verified), so the
// reconstruction stays exact. Idempotent: feed-sourced statements are tagged
// notes='bukku-feed' and fully rebuilt each run, never touching PDF data.
// Self-healing — a missed day is caught on the next run.

import { prisma } from "@/lib/prisma";
import { classifyBankLine } from "./bank-line-classifier";
import { fetchLearnedHints } from "./category-hints";
import {
  listBankFeeds,
  fetchRawFeedLines,
  mapRawFeedToLines,
  type BukkuCreds,
  type BukkuBankLineDraft,
} from "./bukku-bank";

const FEED_NOTE = "bukku-feed";

export type FeedSyncAccountResult = {
  subdomain: string;
  accountTail: string;
  accountName: string | null;
  anchorDate: string | null;
  anchorBalance: number | null;
  newLines: number;
  latestDate: string | null;
  endingBalance: number | null;
  statements: number;
  committed: boolean;
  skipped?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthStart(m: string): Date {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1));
}
function monthEnd(m: string): Date {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0));
}

// Normalized procurement supplier names for the classifier's vendor-registry
// pass: onboarding a supplier is enough for their bank payments to classify as
// RAW_MATERIALS — no classifier rule edit needed. Names are uppercased,
// single-spaced, stripped of "THE " and a trailing SDN BHD; short results are
// dropped (too collision-prone against bank references).
export async function supplierVendorHints(): Promise<string[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { supplierCode: { not: "ADHOC" } },
    select: { name: true },
  });
  const hints = new Set<string>();
  for (const s of suppliers) {
    const n = s.name.toUpperCase().replace(/\s+/g, " ").trim()
      .replace(/^THE /, "")
      .replace(/\s*SDN\.?\s*BHD\.?\s*$/, "")
      .trim();
    if (n.length >= 6) hints.add(n);
  }
  return [...hints];
}

// Distinct Bukku companies (dedupe outlets that share a subdomain, e.g.
// Shah Alam + Nilai both on CCSB).
async function bukkuCompanies(): Promise<BukkuCreds[]> {
  const outlets = await prisma.outlet.findMany({
    where: { bukkuToken: { not: null }, bukkuSubdomain: { not: null } },
    select: { bukkuToken: true, bukkuSubdomain: true },
  });
  const bySub = new Map<string, BukkuCreds>();
  for (const o of outlets) {
    if (o.bukkuToken && o.bukkuSubdomain && !bySub.has(o.bukkuSubdomain)) {
      bySub.set(o.bukkuSubdomain, { token: o.bukkuToken, subdomain: o.bukkuSubdomain });
    }
  }
  return [...bySub.values()];
}

async function syncAccount(
  creds: BukkuCreds,
  feedId: number,
  linkedAccountId: number,
  extNumber: string,
  adminId: string,
  commit: boolean,
): Promise<FeedSyncAccountResult> {
  const accountTail = (extNumber || "").replace(/\D/g, "").slice(-4);
  const base: FeedSyncAccountResult = {
    subdomain: creds.subdomain, accountTail, accountName: null,
    anchorDate: null, anchorBalance: null, newLines: 0, latestDate: null,
    endingBalance: null, statements: 0, committed: false,
  };

  // Anchor on the latest PDF statement for this account (not our own feed rows).
  const anchor = await prisma.bankStatement.findFirst({
    where: { accountName: { contains: accountTail }, notes: { not: FEED_NOTE } },
    orderBy: { periodEnd: "desc" },
    select: { accountName: true, periodEnd: true, closingBalance: true },
  });
  if (!anchor?.periodEnd || !anchor.accountName) {
    return { ...base, skipped: "no PDF anchor" };
  }
  const accountName = anchor.accountName;
  const anchorYmd = ymd(anchor.periodEnd);
  const anchorBal = Number(anchor.closingBalance);

  // The anchor is supposed to advance monthly (Maybank PDF watcher). When the
  // PDFs stop, the rebuild window grows without bound until even the enlarged
  // transaction budget blows (P2028) and the whole finance loop wedges
  // silently. That is exactly what happened to Conezion: last PDF 2026-05-31,
  // wedged from 2026-08-29. Shout early instead.
  const anchorAgeDays = Math.floor((Date.now() - anchor.periodEnd.getTime()) / 86_400_000);
  if (anchorAgeDays > 45) {
    console.error(
      `[bukku-feed-sync] PDF anchor for ${accountName} is ${anchorAgeDays} days old (${anchorYmd}); ` +
      `upload the missing monthly Maybank PDFs to re-anchor this account`,
    );
  }

  // Self-anchor on our own FROZEN feed months so a stale PDF anchor cannot
  // grow the rebuild window without bound (that growth is what wedged the
  // loop from 2026-08-29: full-window rebuilds blew the transaction budget,
  // then the route's 300s wall). A feed month whose periodEnd is older than
  // 40 days has been rebuilt stably dozens of times; freeze it and chain
  // from its stored closing instead of re-deriving it from the PDF anchor.
  // A newer PDF, when it finally arrives, still wins (it is ground truth):
  // we take whichever anchor is LATER.
  let effAnchorYmd = anchorYmd;
  let effAnchorBal = anchorBal;
  const freezeBefore = new Date(Date.now() - 40 * 86_400_000);
  const frozenFeed = await prisma.bankStatement.findFirst({
    where: {
      accountName, notes: FEED_NOTE,
      periodEnd: { lte: freezeBefore, gt: anchor.periodEnd },
    },
    orderBy: { periodEnd: "desc" },
    select: { periodEnd: true, closingBalance: true },
  });
  if (frozenFeed?.periodEnd) {
    effAnchorYmd = ymd(frozenFeed.periodEnd);
    effAnchorBal = Number(frozenFeed.closingBalance);
  }

  // Bound the fetch to lines after the anchor — the daily cron never pulls
  // the full history (the PDF anchor advances monthly to keep this small).
  const lines = mapRawFeedToLines(await fetchRawFeedLines(creds, feedId, linkedAccountId, { stopAtOrBeforeYmd: effAnchorYmd }))
    .filter((l) => l.txnDate > effAnchorYmd)
    .sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.bukkuId - b.bukkuId);

  if (lines.length === 0) {
    return { ...base, accountName, anchorDate: anchorYmd, anchorBalance: anchorBal, skipped: "already current" };
  }

  // Group by month, reconstruct closings from the anchor.
  const byMonth = new Map<string, BukkuBankLineDraft[]>();
  for (const l of lines) {
    const m = l.txnDate.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(l);
    byMonth.set(m, arr);
  }
  let running = effAnchorBal;
  const months = [...byMonth.keys()].sort();
  const plans = months.map((m) => {
    const ls = byMonth.get(m)!;
    let cr = 0, dr = 0;
    for (const l of ls) { if (l.direction === "CR") cr += l.amount; else dr += l.amount; }
    running = round2(running + cr - dr);
    return { month: m, cr: round2(cr), dr: round2(dr), closing: running, lines: ls };
  });

  if (commit) {
    // Outlet hints come from the line description (CONEZION / TAMARIND / etc.).
    const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
    const codeToId = new Map(outlets.map((o) => [o.code, o.id]));
    const vendorHints = await supplierVendorHints();
    // Learned corrections (fin_category_hints) outrank keyword rules; a payee
    // the owner corrected once classifies right on every future feed rebuild.
    let learnedHints: Awaited<ReturnType<typeof fetchLearnedHints>> = [];
    try { learnedHints = await fetchLearnedHints(); } catch { /* additive */ }
    const classify = (l: BukkuBankLineDraft) => {
      const cls = classifyBankLine({ description: l.description, reference: l.reference, amount: l.amount, direction: l.direction, accountKey: accountName, vendorHints, learnedHints });
      return {
        category: cls.category,
        outletId: cls.outletCode ? codeToId.get(cls.outletCode) ?? null : null,
        // Transfers are inter-co by construction; otherwise trust the rule.
        isInterCo: l.isInterCo || cls.isInterCo,
        ruleName: cls.ruleName,
      };
    };
    // A rebuilt line is the SAME bank transaction as the row it replaces, so
    // downstream state must survive the wipe: GL journal links (else the poster
    // re-posts the whole window every run = duplicate journals), AP matches,
    // and human classifications. Feed lines re-create in a deterministic order
    // (txnDate, bukkuId), so a per-key occurrence queue restores state even
    // when two lines share date+amount+description.
    const lineKey = (l: { txnDate: Date; direction: string; amount: unknown; description: string }) =>
      `${ymd(l.txnDate)}|${l.direction}|${Number(l.amount).toFixed(2)}|${l.description}`;
    // One transaction PER MONTH, oldest first, each bounded — the previous
    // whole-window transaction outgrew even a 120s budget once the anchor went
    // stale (months of lines), wedging the loop with P2028 on every run.
    // Month chunks are safe: statements are per-month, lines cannot move
    // between months (txnDate is in the carry key), and closings are computed
    // upfront by chaining from the anchor — so a partially completed run
    // leaves earlier months correct and the next run resumes the rest.
    const planStarts = new Set(plans.map((s2) => monthStart(s2.month).getTime()));
    // Parity with the old full wipe: drop any feed statement for a month the
    // plan no longer contains (practically never happens; feed is append-only).
    const staleStmts = await prisma.bankStatement.findMany({
      where: { accountName, notes: FEED_NOTE, periodEnd: { gt: new Date(effAnchorYmd + "T00:00:00Z") } },
      select: { id: true, periodStart: true },
    });
    const staleIds = staleStmts.filter((st) => !st.periodStart || !planStarts.has(st.periodStart.getTime())).map((st) => st.id);
    if (staleIds.length) await prisma.bankStatement.deleteMany({ where: { id: { in: staleIds } } });

    for (let i = 0; i < plans.length; i++) {
      const s = plans[i];
      const isCurrent = i === plans.length - 1;
      const periodEnd = isCurrent
        ? new Date(s.lines[s.lines.length - 1].txnDate + "T00:00:00Z")
        : monthEnd(s.month);
      const mStart = monthStart(s.month);
      await prisma.$transaction(async (tx) => {
        const oldLines = await tx.bankStatementLine.findMany({
          where: { statement: { accountName, notes: FEED_NOTE, periodStart: mStart } },
          select: {
            txnDate: true, amount: true, direction: true, description: true,
            category: true, classifiedBy: true, ruleName: true, isInterCo: true, outletId: true,
            glTransactionId: true, glPostedAt: true, apInvoiceId: true, apMatchedAt: true,
            expenseMonth: true,
          },
          orderBy: [{ txnDate: "asc" }, { id: "asc" }],
        });
        const carry = new Map<string, typeof oldLines>();
        for (const l of oldLines) {
          const k = lineKey(l);
          const q = carry.get(k);
          if (q) q.push(l); else carry.set(k, [l]);
        }

        await tx.bankStatement.deleteMany({ where: { accountName, notes: FEED_NOTE, periodStart: mStart } });
        await tx.bankStatement.create({
          data: {
            accountName, statementDate: periodEnd, periodStart: mStart, periodEnd,
            closingBalance: s.closing, totalInflows: s.cr, totalOutflows: s.dr,
            uploadedById: adminId, notes: FEED_NOTE,
            lines: {
              create: s.lines.map((l) => {
                const c = classify(l);
                return {
                  txnDate: new Date(l.txnDate + "T00:00:00Z"), description: l.description,
                  reference: l.reference, amount: l.amount, direction: l.direction,
                  category: c.category, outletId: c.outletId, isInterCo: c.isInterCo,
                  classifiedBy: "rule", ruleName: c.ruleName,
                };
              }),
            },
          },
        });

        // Restore carried state onto the recreated lines. Batched by identical
        // payload — most lines share a glTransactionId (one journal per day),
        // so this is a handful of updateMany calls, not one per line.
        if (carry.size) {
          const fresh = await tx.bankStatementLine.findMany({
            where: { statement: { accountName, notes: FEED_NOTE, periodStart: mStart } },
            select: { id: true, txnDate: true, amount: true, direction: true, description: true },
            orderBy: [{ txnDate: "asc" }, { id: "asc" }],
          });
          type CarryData = Record<string, unknown>;
          const batches = new Map<string, { data: CarryData; ids: string[] }>();
          for (const nl of fresh) {
            const old = carry.get(lineKey(nl))?.shift();
            if (!old) continue;
            const data: CarryData = {};
            if (old.glTransactionId) { data.glTransactionId = old.glTransactionId; data.glPostedAt = old.glPostedAt; }
            if (old.apInvoiceId) { data.apInvoiceId = old.apInvoiceId; data.apMatchedAt = old.apMatchedAt; }
            // Expense-month overrides are user state, they must survive the
            // rebuild or the accrual P&L silently reverts within 6 hours.
            if (old.expenseMonth) { data.expenseMonth = old.expenseMonth; }
            if (old.classifiedBy && old.classifiedBy !== "rule") {
              data.category = old.category; data.classifiedBy = old.classifiedBy; data.ruleName = old.ruleName;
              data.isInterCo = old.isInterCo; data.outletId = old.outletId;
            }
            if (!Object.keys(data).length) continue;
            const bk = JSON.stringify(data);
            const b = batches.get(bk);
            if (b) b.ids.push(nl.id); else batches.set(bk, { data, ids: [nl.id] });
          }
          for (const b of batches.values()) {
            await tx.bankStatementLine.updateMany({ where: { id: { in: b.ids } }, data: b.data });
          }
        }
      }, { timeout: 120_000, maxWait: 15_000 });
    }
  }

  return {
    ...base, accountName, anchorDate: anchorYmd, anchorBalance: anchorBal,
    newLines: lines.length, latestDate: lines[lines.length - 1].txnDate,
    endingBalance: running, statements: plans.length, committed: commit,
  };
}

export async function syncBukkuFeedLedger(opts: { commit?: boolean } = {}): Promise<{
  commit: boolean;
  accounts: FeedSyncAccountResult[];
}> {
  const commit = opts.commit ?? true;
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("syncBukkuFeedLedger: no ADMIN user for uploadedById");

  const results: FeedSyncAccountResult[] = [];
  for (const creds of await bukkuCompanies()) {
    let feeds;
    try {
      feeds = await listBankFeeds(creds);
    } catch (e) {
      results.push({
        subdomain: creds.subdomain, accountTail: "", accountName: null, anchorDate: null,
        anchorBalance: null, newLines: 0, latestDate: null, endingBalance: null,
        statements: 0, committed: false, skipped: `feed error: ${(e as Error).message}`,
      });
      continue;
    }
    for (const feed of feeds) {
      if (!feed.is_linked) continue;
      for (const fa of feed.accounts ?? []) {
        if (!fa.linked_account_id) continue;
        results.push(await syncAccount(creds, feed.id, fa.linked_account_id, fa.ext_number, admin.id, commit));
      }
    }
  }
  return { commit, accounts: results };
}
