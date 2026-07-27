// Cash-out coverage — every supplier payment should tie to an invoice.
//
// The flip side of the AP accrual: make sure money that LEFT the bank for
// supplier-type spend is backed by an invoice in the register. A payment with
// no invoice is unsupported spend (missing documentation, or worse). This:
//   1. measures coverage — matched vs unmatched supplier cash-out per entity,
//   2. safe-links the deterministic ones — a bank line whose description carries
//      an invoice number that resolves to exactly one invoice of the right
//      amount and entity (links even already-paid invoices, which ap-match skips
//      because it only matches OPEN invoices; this sets the link, not the status),
//   3. leaves the residual as the flag list — cash-out with no invoice to capture.
//
// Deterministic only: we never guess among recurring same-amount payments to the
// same supplier (e.g. the RM2,533.50 Collective Project runs) — those need the
// invoice number, so if it is absent the line stays unmatched and surfaces.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "./supabase";
import { sendMessage } from "@/lib/telegram";

export const CASH_OUT_COVERAGE_VERSION = "cash-out-coverage-v1";

// Categories a supplier invoice should back. Wages/rent/statutory/tax/mgmt-fee
// etc. are not invoiceable and are excluded.
export const INVOICEABLE_CATEGORIES = [
  "RAW_MATERIALS", "DELIVERY", "EQUIPMENTS", "MAINTENANCE", "SOFTWARE", "OUTLET_SUPPLIES",
] as const;

// Entity ↔ Maybank account suffix (BankStatement.accountName carries "(4384)").
const ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CoverageRow = {
  company: string;
  category: string;
  lines: number;
  amount: number;
  matchedLines: number;
  matchedAmount: number;
  unmatchedLines: number;
  unmatchedAmount: number;
  coveragePct: number | null; // by amount
};

export type CashOutCoverage = {
  from: string;
  to: string;
  rows: CoverageRow[];
  totals: { amount: number; matchedAmount: number; unmatchedAmount: number; coveragePct: number | null };
};

export async function buildCashOutCoverage(from: string, to: string): Promise<CashOutCoverage> {
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(`${to}T23:59:59+08:00`);
  const cats = INVOICEABLE_CATEGORIES.join("','");

  const rows = await prisma.$queryRawUnsafe<{ suffix: string; category: string; lines: number; amount: number; matched_lines: number; matched_amount: number }[]>(`
    SELECT substring(s."accountName" from '\\((\\d{4})\\)') AS suffix,
           l.category::text AS category,
           COUNT(*)::int AS lines,
           COALESCE(SUM(l.amount),0)::float AS amount,
           COUNT(l."apInvoiceId")::int AS matched_lines,
           COALESCE(SUM(CASE WHEN l."apInvoiceId" IS NOT NULL THEN l.amount ELSE 0 END),0)::float AS matched_amount
    FROM "BankStatementLine" l
    JOIN "BankStatement" s ON s.id = l."statementId"
    WHERE l.direction='DR' AND l."isInterCo"=false
      AND l.category::text IN ('${cats}')
      AND l."txnDate" >= $1 AND l."txnDate" <= $2
    GROUP BY 1,2
  `, start, end);

  const suffixCompany: Record<string, string> = Object.fromEntries(Object.entries(ACCOUNT_SUFFIX).map(([c, s]) => [s, c]));
  const out: CoverageRow[] = [];
  for (const r of rows) {
    const company = suffixCompany[r.suffix ?? ""] ?? "(other)";
    const amount = round2(Number(r.amount));
    const matchedAmount = round2(Number(r.matched_amount));
    const unmatchedAmount = round2(amount - matchedAmount);
    out.push({
      company, category: r.category,
      lines: Number(r.lines), amount,
      matchedLines: Number(r.matched_lines), matchedAmount,
      unmatchedLines: Number(r.lines) - Number(r.matched_lines), unmatchedAmount,
      coveragePct: amount > 0 ? round2((matchedAmount / amount) * 100) : null,
    });
  }
  out.sort((a, b) => b.unmatchedAmount - a.unmatchedAmount);
  const tAmount = round2(out.reduce((s, r) => s + r.amount, 0));
  const tMatched = round2(out.reduce((s, r) => s + r.matchedAmount, 0));
  return {
    from, to, rows: out,
    totals: {
      amount: tAmount, matchedAmount: tMatched, unmatchedAmount: round2(tAmount - tMatched),
      coveragePct: tAmount > 0 ? round2((tMatched / tAmount) * 100) : null,
    },
  };
}

export type LinkResult = {
  scanned: number;      // unmatched supplier lines examined
  linked: number;       // lines linked to an invoice by number
  linkedAmount: number;
  ambiguous: number;    // invoice-number/amount matched >1 invoice — left for review
  residual: number;     // still unmatched after linking
  residualAmount: number;
  dryRun: boolean;
  samples: { bankLineId: string; description: string; amount: number; invoiceNumber: string; invoiceId: string }[];
};

// Link unmatched supplier cash-out to the invoice whose number appears in the
// bank description, when that resolves to exactly ONE invoice of the right
// amount (± RM1) and entity. Sets BankStatementLine.apInvoiceId (the link) —
// it does NOT change invoice status, so already-paid bills are just linked.
export async function linkCashOutByInvoiceNumber(from: string, to: string, opts: { dryRun?: boolean } = {}): Promise<LinkResult> {
  const dryRun = opts.dryRun ?? true;
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(`${to}T23:59:59+08:00`);

  const cats = INVOICEABLE_CATEGORIES.join("','");
  const lines = await prisma.$queryRawUnsafe<{ id: string; description: string; amount: number; suffix: string }[]>(`
    SELECT l.id, l.description, l.amount::float AS amount, substring(s."accountName" from '\\((\\d{4})\\)') AS suffix
    FROM "BankStatementLine" l JOIN "BankStatement" s ON s.id = l."statementId"
    WHERE l.direction='DR' AND l."apInvoiceId" IS NULL AND l."isInterCo"=false
      AND l.category::text IN ('${cats}')
      AND l."txnDate" >= $1 AND l."txnDate" <= $2
  `, start, end);

  // Candidate invoices: number, amount, entity (via outlet→company). Load once.
  const suffixCompany: Record<string, string> = Object.fromEntries(Object.entries(ACCOUNT_SUFFIX).map(([c, s]) => [s, c]));
  const invoices = await prisma.$queryRawUnsafe<{ id: string; number: string; amount: number; company: string }[]>(`
    SELECT i.id, upper(i."invoiceNumber") AS number, i.amount::float AS amount, fc.company_id AS company
    FROM "Invoice" i
    JOIN fin_outlet_companies fc ON fc.outlet_id = i."outletId"
    WHERE i."invoiceNumber" IS NOT NULL AND length(i."invoiceNumber") >= 4
  `);
  const byCompany = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const arr = byCompany.get(inv.company) ?? [];
    arr.push(inv); byCompany.set(inv.company, arr);
  }

  let linked = 0, linkedAmount = 0, ambiguous = 0;
  const samples: LinkResult["samples"] = [];
  for (const l of lines) {
    const company = suffixCompany[l.suffix ?? ""];
    if (!company) continue;
    const desc = (l.description ?? "").toUpperCase();
    const hits = (byCompany.get(company) ?? []).filter(
      (inv) => inv.number && desc.includes(inv.number) && Math.abs(Number(inv.amount) - Number(l.amount)) <= 1.0
    );
    if (hits.length === 1) {
      const inv = hits[0];
      if (samples.length < 12) samples.push({ bankLineId: l.id, description: l.description, amount: round2(Number(l.amount)), invoiceNumber: inv.number, invoiceId: inv.id });
      if (!dryRun) {
        await prisma.bankStatementLine.update({ where: { id: l.id }, data: { apInvoiceId: inv.id } });
      }
      linked++; linkedAmount += Number(l.amount);
    } else if (hits.length > 1) {
      ambiguous++;
    }
  }
  return {
    scanned: lines.length, linked, linkedAmount: round2(linkedAmount), ambiguous,
    residual: lines.length - linked, residualAmount: 0, dryRun, samples,
  };
}

// Top unsupported payees — the invoice-capture gap. Rough payee extraction from
// the bank description (the classifier's supplier registry is richer, but this
// is enough to name who we are missing invoices from in the digest).
export type UnsupportedPayee = { payee: string; lines: number; amount: number };
export async function topUnsupportedPayees(from: string, to: string, limit = 10): Promise<UnsupportedPayee[]> {
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(`${to}T23:59:59+08:00`);
  const cats = INVOICEABLE_CATEGORIES.join("','");
  const rows = await prisma.$queryRawUnsafe<{ payee: string; lines: number; amount: number }[]>(`
    SELECT
      upper(coalesce(
        substring(l.description from 'A/C ([A-Za-z][A-Za-z &.]{3,24})'),
        regexp_replace(l.description, '^(Celsius Coffee (Putra|Shah|Tamar|Nilai)[A-Za-z]*)', '', 'i')
      )) AS payee,
      COUNT(*)::int AS lines,
      COALESCE(SUM(l.amount),0)::float AS amount
    FROM "BankStatementLine" l
    WHERE l.direction='DR' AND l."apInvoiceId" IS NULL AND l."isInterCo"=false
      AND l.category::text IN ('${cats}')
      AND l."txnDate" >= $1 AND l."txnDate" <= $2
    GROUP BY 1 ORDER BY 3 DESC LIMIT ${Math.max(1, Math.min(50, limit))}
  `, start, end);
  return rows.map((r) => ({ payee: (r.payee ?? "(unknown)").trim().slice(0, 30) || "(unknown)", lines: Number(r.lines), amount: round2(Number(r.amount)) }));
}

const rm = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;

// The watchdog: link what is safely linkable, measure coverage over a trailing
// window, name the biggest unsupported payees, log to fin_agent_decisions, and
// send an owner digest. Every supplier payment should be invoice-backed; this
// keeps that honest and flags the capture gap that isn't.
export async function runCashOutCoverageWatch(from: string, to: string, opts: { apply?: boolean } = {}): Promise<{
  from: string; to: string; linked: number; coveragePct: number | null; unmatchedAmount: number; unsupported: UnsupportedPayee[]; logged: number; delivered: boolean;
}> {
  const link = await linkCashOutByInvoiceNumber(from, to, { dryRun: !(opts.apply ?? true) });
  const cov = await buildCashOutCoverage(from, to);
  const unsupported = await topUnsupportedPayees(from, to, 8);

  // Log the coverage snapshot + each material unsupported payee to the shared
  // agent ledger, so the capture gap is measurable and trainable.
  const client = getFinanceClient();
  const rows = unsupported
    .filter((u) => u.amount >= 500)
    .map((u) => ({
      id: randomUUID(),
      agent: "cash-out-coverage",
      agent_version: CASH_OUT_COVERAGE_VERSION,
      input: { from, to, payee: u.payee },
      output: { lines: u.lines, amount: u.amount, note: "supplier cash-out with no captured invoice" },
      confidence: 1.0,
      applied: false,
      related_type: "cash_out_unsupported",
      related_id: u.payee,
    }));
  let logged = 0;
  if (rows.length) {
    const { error } = await client.from("fin_agent_decisions").insert(rows);
    if (!error) logged = rows.length;
  }

  let delivered = false;
  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  const chatId = chatRaw ? parseInt(chatRaw, 10) : NaN;
  if (!Number.isNaN(chatId)) {
    const lines = [
      `<b>Cash-out coverage</b> ${from}→${to}`,
      `${cov.totals.coveragePct}% of supplier cash-out is invoice-matched (${rm(cov.totals.matchedAmount)} of ${rm(cov.totals.amount)}).`,
      opts.apply === false ? "" : `Linked ${link.linked} more by invoice number (${rm(link.linkedAmount)}).`,
      `Unsupported: ${rm(cov.totals.unmatchedAmount)} with no invoice. Top to capture:`,
      ...unsupported.filter((u) => u.amount >= 500).map((u) => `• ${u.payee} — ${rm(u.amount)} (${u.lines})`),
      `\nCapture these bills in /finance so every payment is backed.`,
    ].filter(Boolean);
    try {
      const res = await sendMessage(chatId, lines.join("\n"));
      delivered = res.ok;
    } catch (e) {
      console.error("[cash-out-coverage] telegram send failed", e);
    }
  }

  return { from, to, linked: link.linked, coveragePct: cov.totals.coveragePct, unmatchedAmount: cov.totals.unmatchedAmount, unsupported, logged, delivered };
}
