// Bank-feed → General Ledger posting bridge (the loop's POST step).
//
// Every classified BankStatementLine is a real cash movement that, until now,
// drove the cashflow/P&L *views* but never hit the double-entry ledger — which
// is why the Balance Sheet and Cash Flow were "draft". This posts them.
//
// Model: the EOD Sales agent already accrues daily revenue into DEBTOR accounts
// (Dr 1006 card / 1005 grab / 1000-02 cash+QR, Cr 5000-xx income). So a bank
// INFLOW does not re-recognise income — it CLEARS the debtor that EOD created.
// A bank OUTFLOW recognises the expense/asset/liability at payment (cash basis).
// Either way BANK_CASH (1000-01) is one leg and the mapped contra is the other,
// with the line's direction deciding which side the bank sits on.
//
// Volume: there are tens of thousands of micro-settlements, so lines are
// AGGREGATED into one journal per (company, outlet, category, day) — how a
// bookkeeper posts, and it keeps the ledger legible while still tying out to the
// bank to the cent. Each contributing line is stamped with the journal id
// (glTransactionId) so the poster is idempotent: a line is posted exactly once,
// and newly-arrived lines for an already-posted day get their own delta journal.

import { prisma } from "@/lib/prisma";
import { postJournal } from "./ledger";
import type { JournalLineInput } from "./types";

const BANK_CASH = "1000-01"; // Bank Account (per company via fin_transactions.company_id)
const SUSPENSE = "1999";     // Suspense / Unclassified — keeps the bank tied out

// CashCategory → contra GL account code. The bank line's direction (CR in / DR
// out) decides which side BANK_CASH sits on; the contra always takes the other.
export const CONTRA_ACCOUNT: Record<string, string> = {
  // ── inflows: revenue already accrued by EOD Sales → clear the debtor ──
  CARD: "1006",            // Debit/credit card debtors
  STOREHUB: "1006",        // legacy POS card-style settlement
  QR: "1000-02",           // DuitNow QR / cash banked out of Cash on Hand
  GRAB: "1005",            // Grabfood debtors
  GRAB_PUTRAJAYA: "1999",  // settles into HQ bank but debtor sits in Conezion — cross-entity, park in suspense
  FOODPANDA: "1005",       // marketplace debtor (no separate FP account yet)
  // ── inflows NOT in EOD (B2B / online) → recognise income directly ──
  REVENUE_MONSTER: "5000-01", // online pickup + table-QR sales
  MEETINGS_EVENTS: "5000-10",
  GASTROHUB: "5000-09",
  // ── cost of sales ──
  RAW_MATERIALS: "6000-01",
  DELIVERY: "6000-02",
  // ── marketing ──
  DIGITAL_ADS: "6503-01",
  OTHER_MARKETING: "6503",
  KOL: "6503-03",
  MARKETPLACE_FEE: "6519", // Grab/FP commission = merchant fees
  // ── operating expenses ──
  RENT: "6504",
  UTILITIES: "6505",
  SOFTWARE: "6508",
  MAINTENANCE: "6506",
  STAFF_CLAIM: "6507",     // reimbursed outlet buys
  EMPLOYEE_SALARY: "6500-02",
  PARTIMER: "6500-03",
  STATUTORY_PAYMENT: "6501",
  TAX: "6900",
  COMPLIANCE: "6510",
  LICENSING_FEE: "6510-02",
  ROYALTY_FEE: "6511-06",
  CFS_FEE: "6511",
  MANAGEMENT_FEE: "6511-06",
  BANK_FEE: "6514",
  // ── balance-sheet movements ──
  PETTY_CASH: "1000-02",   // bank → petty cash float (asset ↔ asset)
  EQUIPMENTS: "1500-02",   // capex — defaults to Kitchen equipment, refine on review
  INVESTMENTS: "1500-04",  // renovation capex
  LOAN: "3010",            // Short-term Loans
  CAPITAL: "4001",         // Owner's Share Capital
  DIVIDEND: "4000",        // Retained Earnings (distribution)
  DIRECTORS_ALLOWANCE: "3400", // Due To Directors
  ADTD: "3400",            // Amount Due To Director
};

// Park-in-suspense: real BS holding account so the bank still ties out while the
// nature is resolved (AP-match, reclassification). Inter-co transfers belong on
// a proper inter-co account once one exists; suspense until then.
const SUSPENSE_CATS = new Set([
  "OTHER_OUTFLOW", "OTHER_INFLOW",
  "INTERCO_PEOPLE", "INTERCO_RAW_MATERIAL", "INTERCO_INVESTMENTS", "INTERCO_EXPENSES",
]);
// Failed transfers reverse themselves on the statement — never hit the ledger.
const SKIP_CATS = new Set(["TRANSFER_NOT_SUCCESSFUL"]);

// Resolve the legal entity (fin_companies.id) that owns a bank line, from the
// statement's account name. (…2644) Conezion, (…9345) Tamarind, (…4384) the
// Celsius Coffee SB HQ account that also carries Shah Alam + Nilai.
export function companyFromAccountName(accountName: string): string {
  if (/CONEZION|2644/i.test(accountName)) return "celsiusconezion";
  if (/TAMARIND|9345/i.test(accountName)) return "celsiustamarind";
  return "celsius";
}

// The contra account + whether it is a confident mapping or a suspense parking.
export function contraFor(category: string): { code: string; suspense: boolean } {
  if (CONTRA_ACCOUNT[category]) return { code: CONTRA_ACCOUNT[category], suspense: false };
  return { code: SUSPENSE, suspense: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Group = {
  company: string;
  outletId: string | null;
  category: string;
  date: string;          // YYYY-MM-DD
  direction: "CR" | "DR";
  amount: number;
  lineIds: string[];
};

export type GlPostResult = {
  committed: boolean;
  scannedLines: number;
  journals: number;        // journals posted (or that would post)
  postedLines: number;     // bank lines that landed in a journal
  skippedLines: number;    // TRANSFER_NOT_SUCCESSFUL
  suspenseLines: number;   // parked in 1999
  totalDebit: number;
  totalCredit: number;
  byCategory: { category: string; account: string; direction: string; journals: number; lines: number; amount: number; suspense: boolean }[];
  errors: { company: string; category: string; date: string; error: string }[];
};

// Post all not-yet-posted classified bank lines into the ledger. Dry-run by
// default (commit:false) — returns the journals it *would* post plus a coverage
// breakdown so the result can be eyeballed before anything hits the GL.
export async function postBankLinesToGl(
  opts: { commit?: boolean; sinceDays?: number; limit?: number } = {},
): Promise<GlPostResult> {
  const commit = opts.commit ?? false;

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      category: { not: null },
      glTransactionId: null,
      ...(opts.sinceDays ? { txnDate: { gte: new Date(Date.now() - opts.sinceDays * 86_400_000) } } : {}),
    },
    select: {
      id: true, txnDate: true, amount: true, direction: true, category: true, outletId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
    take: opts.limit,
  });

  // Aggregate into one journal per (company, outlet, category, day, direction).
  const groups = new Map<string, Group>();
  let skippedLines = 0;
  for (const l of lines) {
    const category = l.category as string;
    if (SKIP_CATS.has(category)) { skippedLines++; continue; }
    const company = companyFromAccountName(l.statement.accountName);
    const date = l.txnDate.toISOString().slice(0, 10);
    const direction = l.direction as "CR" | "DR";
    const key = [company, l.outletId ?? "", category, date, direction].join("|");
    const g = groups.get(key);
    if (g) { g.amount = round2(g.amount + Number(l.amount)); g.lineIds.push(l.id); }
    else groups.set(key, { company, outletId: l.outletId, category, date, direction, amount: round2(Number(l.amount)), lineIds: [l.id] });
  }

  const byCat = new Map<string, { account: string; direction: string; journals: number; lines: number; amount: number; suspense: boolean }>();
  const errors: GlPostResult["errors"] = [];
  let journals = 0, postedLines = 0, suspenseLines = 0, totalDebit = 0, totalCredit = 0;

  for (const g of groups.values()) {
    if (g.amount <= 0) continue;
    const { code: contra, suspense } = contraFor(g.category);
    // CR = money in → Dr Bank, Cr contra. DR = money out → Dr contra, Cr Bank.
    const journalLines: JournalLineInput[] = g.direction === "CR"
      ? [{ accountCode: BANK_CASH, debit: g.amount, outletId: g.outletId }, { accountCode: contra, credit: g.amount, outletId: g.outletId }]
      : [{ accountCode: contra, debit: g.amount, outletId: g.outletId }, { accountCode: BANK_CASH, credit: g.amount, outletId: g.outletId }];

    const ck = `${g.category}|${g.direction}`;
    const agg = byCat.get(ck) ?? { account: contra, direction: g.direction, journals: 0, lines: 0, amount: 0, suspense };
    agg.journals++; agg.lines += g.lineIds.length; agg.amount = round2(agg.amount + g.amount);
    byCat.set(ck, agg);

    journals++;
    postedLines += g.lineIds.length;
    if (suspense) suspenseLines += g.lineIds.length;
    totalDebit = round2(totalDebit + g.amount);
    totalCredit = round2(totalCredit + g.amount);

    if (!commit) continue;
    try {
      const desc = `Bank ${g.direction === "CR" ? "receipts" : "payments"} — ${g.category} ${g.date} (${g.lineIds.length} line${g.lineIds.length > 1 ? "s" : ""})`;
      const res = await postJournal({
        companyId: g.company,
        txnDate: g.date,
        description: desc,
        txnType: "payment",
        outletId: g.outletId,
        agent: "bank",
        agentVersion: "bank-gl-v1",
        confidence: 1,
        lines: journalLines,
      });
      await prisma.bankStatementLine.updateMany({
        where: { id: { in: g.lineIds } },
        data: { glTransactionId: res.transactionId, glPostedAt: new Date() },
      });
    } catch (err) {
      errors.push({ company: g.company, category: g.category, date: g.date, error: err instanceof Error ? err.message : String(err) });
      journals--; postedLines -= g.lineIds.length;
      totalDebit = round2(totalDebit - g.amount); totalCredit = round2(totalCredit - g.amount);
    }
  }

  const byCategory = [...byCat.entries()]
    .map(([k, v]) => ({ category: k.split("|")[0], account: v.account, direction: v.direction, journals: v.journals, lines: v.lines, amount: v.amount, suspense: v.suspense }))
    .sort((a, b) => b.amount - a.amount);

  return {
    committed: commit,
    scannedLines: lines.length,
    journals, postedLines, skippedLines, suspenseLines,
    totalDebit, totalCredit, byCategory, errors,
  };
}
