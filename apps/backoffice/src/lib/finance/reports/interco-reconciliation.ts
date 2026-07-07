// Inter-company pairing reconciliation. Strictly READ-ONLY: it reads the posted
// GL (fin_journal_lines joined fin_transactions) for the 3600 due-to/from control
// accounts and the bank feed (BankStatementLine) for the receiver-side inbound
// legs, so the owner can see WHY the 3600 accounts do not net to zero before any
// clearing journals are posted.
//
// How inter-entity transfers are booked today:
//   PAYER leg  (present):   Dr 3600-xx (due from the counterparty) / Cr bank.
//                           resolveContra() routes INTERCO_* to 3600-xx.
//   RECEIVER leg (missing):  should be Dr bank / Cr 3600-xx, but the inbound
//                           bank line is tagged with a PURPOSE category
//                           (EMPLOYEE_SALARY / STATUTORY_PAYMENT / OTHER_INFLOW /
//                           LOAN / RAW_MATERIALS) instead of an INTERCO_* one, so
//                           it never credits 3600. Every 3600 account is therefore
//                           100% debits and the group nets to a large positive
//                           residual (~RM69k) that never clears.
//
// MANAGEMENT_FEE inbound is the ONE real cross-charge (HQ service fee, books
// 6511 + REV-MGMT, eliminated in the consolidated P&L), NOT a funding transfer,
// so it is shown on its own row and never counted as a mislabelled 3600 leg.
//
// This report does NOT retag or post any journal. Routing the mislabelled
// inbound legs through 3600 and posting clearing journals is a deliberate
// follow-up, not built here.

import { pagedPostedTxns, pagedJournalLines } from "./paged";
import { prisma } from "@/lib/prisma";

function round2(n: number): number { return Math.round(n * 100) / 100; }

// The 3600 due-to/from control accounts, in display order, with the entity each
// one represents (the counterparty the balance is due to/from). Kept aligned
// with INTERCO_DUE_ACCOUNT in gl-posting-map.ts.
const INTERCO_ACCOUNTS: { code: string; name: string; entity: string | null }[] = [
  { code: "3600-00", name: "Due to/from Celsius Coffee Tamarind", entity: "celsiustamarind" },
  { code: "3600-01", name: "Due to/from Celsius Coffee Conezion", entity: "celsiusconezion" },
  { code: "3600-02", name: "Due to/from Celsius Coffee SB", entity: "celsius" },
  { code: "3600", name: "Due to/from Related Companies (generic)", entity: null },
];
const INTERCO_CODES = INTERCO_ACCOUNTS.map((a) => a.code);

// A company id -> its OWN due-to/from control code. A posting company crediting
// or debiting its own control account is a hygiene issue (an entity should not
// carry a balance due to/from itself).
const OWN_ACCOUNT: Record<string, string> = {
  celsiustamarind: "3600-00",
  celsiusconezion: "3600-01",
  celsius: "3600-02",
};

// The 4-digit Maybank account tail per company, embedded in
// BankStatement.accountName (same mapping the sourced P&L uses).
const BANK_ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

// Inbound (CR) bank categories that are really inter-entity FUNDING and should
// have credited a 3600 control account. MANAGEMENT_FEE is deliberately excluded
// (it is a real service fee, shown on its own row).
const MISLABELLED_INBOUND_CATS = new Set([
  "EMPLOYEE_SALARY", "STATUTORY_PAYMENT", "OTHER_INFLOW", "LOAN", "RAW_MATERIALS",
]);
const MANAGEMENT_FEE_CAT = "MANAGEMENT_FEE";

type Company = { id: string; name: string };

// ─── 3600 balances ──────────────────────────────────────────────────────────

export type IntercoBalanceRow = {
  code: string;
  name: string;
  debits: number;
  credits: number;
  net: number;
  lines: number;
  // Hygiene: lines booked to the bare 3600 code, and lines an entity posted to
  // its own due-to/from control (self-referential).
  bareLines: number;
  bareAmount: number;
  selfLines: number;
  selfAmount: number;
};

// ─── Transfer legs ───────────────────────────────────────────────────────────

export type OutboundLeg = {
  postingCompanyId: string;
  postingCompany: string;
  counterpartyCode: string;   // the 3600-xx the debit landed in
  counterpartyName: string;
  debits: number;
  lines: number;
  hygiene: "self" | "bare" | null; // self-referential or bare-3600 posting
};

export type InboundLeg = {
  receivingCompanyId: string;
  receivingCompany: string;
  category: string;
  amount: number;
  lines: number;
  // Mislabelled funding legs that should route to 3600. MANAGEMENT_FEE is a
  // real service fee (own row) and is never flagged.
  shouldRouteTo3600: boolean;
};

// ─── Would-net-to (pairing) ──────────────────────────────────────────────────

export type WouldNetRow = {
  code: string;
  name: string;
  entity: string | null;
  currentNet: number;         // all-debit today
  inboundFundingCredit: number; // mislabelled inbound funding, notionally credited here
  wouldNet: number;           // currentNet minus inboundFundingCredit
};

export type IntercoReconciliationReport = {
  start: string;
  end: string;
  balances: IntercoBalanceRow[];
  groupNet: number;
  outbound: OutboundLeg[];
  inbound: InboundLeg[];
  managementFeeInbound: { amount: number; lines: number };
  mislabelledInboundTotal: number;
  wouldNet: WouldNetRow[];
  groupWouldNet: number;
  hygiene: {
    bareLines: number;
    bareAmount: number;
    selfLines: number;
    selfAmount: number;
  };
};

// Read every posted 3600 journal line for the companies, from startMonth.
// Returns per-account totals and the outbound legs (grouped by posting company
// and the 3600-xx account debited), plus hygiene tallies.
async function readIntercoGl(
  companies: Company[],
  end: string,
  startMonth: string,
): Promise<{
  balances: Map<string, { debits: number; credits: number; lines: number; bareLines: number; bareAmount: number; selfLines: number; selfAmount: number }>;
  outbound: OutboundLeg[];
}> {
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const balances = new Map<string, { debits: number; credits: number; lines: number; bareLines: number; bareAmount: number; selfLines: number; selfAmount: number }>();
  for (const code of INTERCO_CODES) balances.set(code, { debits: 0, credits: 0, lines: 0, bareLines: 0, bareAmount: 0, selfLines: 0, selfAmount: 0 });

  // company -> counterpartyCode -> { debits, lines, hygiene }
  const outMap = new Map<string, Map<string, { debits: number; lines: number; hygiene: "self" | "bare" | null }>>();

  for (const co of companies) {
    const { txnIds, txnDate } = await pagedPostedTxns([co.id], end);
    for await (const lines of pagedJournalLines(txnIds)) {
      for (const l of lines) {
        if (!INTERCO_CODES.includes(l.account_code)) continue;
        const date = txnDate.get(l.transaction_id);
        if (!date || date.slice(0, 7) < startMonth) continue;
        const debit = round2(Number(l.debit));
        const credit = round2(Number(l.credit));

        const bal = balances.get(l.account_code)!;
        bal.debits = round2(bal.debits + debit);
        bal.credits = round2(bal.credits + credit);
        bal.lines += 1;

        const isBare = l.account_code === "3600";
        const isSelf = OWN_ACCOUNT[co.id] === l.account_code;
        const net = round2(debit - credit);
        if (isBare) { bal.bareLines += 1; bal.bareAmount = round2(bal.bareAmount + net); }
        if (isSelf) { bal.selfLines += 1; bal.selfAmount = round2(bal.selfAmount + net); }

        // Outbound leg = the Dr 3600 posting (the payer recording a due-from).
        if (debit > 0) {
          const byCode = outMap.get(co.id) ?? new Map();
          const cur = byCode.get(l.account_code) ?? { debits: 0, lines: 0, hygiene: null as "self" | "bare" | null };
          cur.debits = round2(cur.debits + debit);
          cur.lines += 1;
          cur.hygiene = isBare ? "bare" : isSelf ? "self" : cur.hygiene;
          byCode.set(l.account_code, cur);
          outMap.set(co.id, byCode);
        }
      }
    }
  }

  const accountName = new Map(INTERCO_ACCOUNTS.map((a) => [a.code, a.name]));
  const outbound: OutboundLeg[] = [];
  for (const [companyId, byCode] of outMap) {
    for (const [code, v] of byCode) {
      outbound.push({
        postingCompanyId: companyId,
        postingCompany: nameById.get(companyId) ?? companyId,
        counterpartyCode: code,
        counterpartyName: accountName.get(code) ?? code,
        debits: v.debits,
        lines: v.lines,
        hygiene: v.hygiene,
      });
    }
  }
  outbound.sort((a, b) => a.postingCompany.localeCompare(b.postingCompany) || a.counterpartyCode.localeCompare(b.counterpartyCode));
  return { balances, outbound };
}

// Resolve a BankStatement.accountName to the receiving company id.
function companyFromAccountName(accountName: string | null): string | null {
  const a = (accountName ?? "").toUpperCase();
  if (a.includes("4384") || a.includes("CELSIUS COFFEE SDN")) return "celsius";
  if (a.includes("2644") || a.includes("CONEZION")) return "celsiusconezion";
  if (a.includes("9345") || a.includes("TAMARIND")) return "celsiustamarind";
  return null;
}

// Read the receiver-side inbound CR legs from the bank feed: interco credits
// (description mentions CELSIUS COFFEE, or isInterCo) grouped by receiving
// entity and current category. Paged via Prisma cursor (findMany batches).
async function readInboundLegs(
  companies: Company[],
  start: string,
  end: string,
): Promise<{ inbound: InboundLeg[]; managementFee: { amount: number; lines: number }; byEntityFunding: Map<string, number> }> {
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const dStart = new Date(`${start}T00:00:00.000Z`);
  const dEnd = new Date(`${end}T23:59:59.999Z`);

  // receivingCompany -> category -> { amount, lines }
  const agg = new Map<string, Map<string, { amount: number; lines: number }>>();
  let mgmtAmount = 0;
  let mgmtLines = 0;

  const PAGE = 1000;
  for (let skip = 0; ; skip += PAGE) {
    const rows = await prisma.bankStatementLine.findMany({
      where: {
        direction: "CR",
        txnDate: { gte: dStart, lte: dEnd },
        OR: [
          { description: { contains: "CELSIUS COFFEE", mode: "insensitive" } },
          { isInterCo: true },
        ],
      },
      select: {
        amount: true, category: true, description: true, isInterCo: true,
        statement: { select: { accountName: true } },
      },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    for (const r of rows) {
      const companyId = companyFromAccountName(r.statement?.accountName ?? null);
      if (!companyId) continue;
      const category = (r.category as string | null) ?? "UNCLASSIFIED";
      const amount = round2(Number(r.amount));
      if (category === MANAGEMENT_FEE_CAT) {
        mgmtAmount = round2(mgmtAmount + amount);
        mgmtLines += 1;
        continue;
      }
      const byCat = agg.get(companyId) ?? new Map();
      const cur = byCat.get(category) ?? { amount: 0, lines: 0 };
      cur.amount = round2(cur.amount + amount);
      cur.lines += 1;
      byCat.set(category, cur);
      agg.set(companyId, byCat);
    }
    if (rows.length < PAGE) break;
  }

  const inbound: InboundLeg[] = [];
  const byEntityFunding = new Map<string, number>();
  for (const [companyId, byCat] of agg) {
    for (const [category, v] of byCat) {
      const shouldRoute = MISLABELLED_INBOUND_CATS.has(category);
      inbound.push({
        receivingCompanyId: companyId,
        receivingCompany: nameById.get(companyId) ?? companyId,
        category,
        amount: v.amount,
        lines: v.lines,
        shouldRouteTo3600: shouldRoute,
      });
      if (shouldRoute) byEntityFunding.set(companyId, round2((byEntityFunding.get(companyId) ?? 0) + v.amount));
    }
  }
  inbound.sort((a, b) =>
    a.receivingCompany.localeCompare(b.receivingCompany) ||
    Number(b.shouldRouteTo3600) - Number(a.shouldRouteTo3600) ||
    b.amount - a.amount);

  return { inbound, managementFee: { amount: mgmtAmount, lines: mgmtLines }, byEntityFunding };
}

export async function buildIntercoReconciliation(input: {
  start: string;
  end: string;
  companies: Company[];
}): Promise<IntercoReconciliationReport> {
  const startMonth = input.start.slice(0, 7);
  // The report is written for the 3 companies that own a bank account and a
  // 3600 control; keep to the ones we can map either way.
  const companies = input.companies.filter((c) => BANK_ACCOUNT_SUFFIX[c.id] || OWN_ACCOUNT[c.id]);

  const { balances, outbound } = await readIntercoGl(companies, input.end, startMonth);
  const { inbound, managementFee, byEntityFunding } = await readInboundLegs(companies, input.start, input.end);

  const balanceRows: IntercoBalanceRow[] = INTERCO_ACCOUNTS.map((a) => {
    const b = balances.get(a.code) ?? { debits: 0, credits: 0, lines: 0, bareLines: 0, bareAmount: 0, selfLines: 0, selfAmount: 0 };
    return {
      code: a.code,
      name: a.name,
      debits: b.debits,
      credits: b.credits,
      net: round2(b.debits - b.credits),
      lines: b.lines,
      bareLines: b.bareLines,
      bareAmount: b.bareAmount,
      selfLines: b.selfLines,
      selfAmount: b.selfAmount,
    };
  });
  const groupNet = round2(balanceRows.reduce((s, r) => s + r.net, 0));

  // Would-net-to: notionally credit each receiving entity's mislabelled inbound
  // funding to its OWN due-to/from control, then re-net. Shows how much of the
  // residual is pairable (funding that should have credited 3600) vs genuinely
  // unmatched (whatever remains).
  const wouldNet: WouldNetRow[] = INTERCO_ACCOUNTS.map((a) => {
    const row = balanceRows.find((r) => r.code === a.code)!;
    // The entity whose OWN control this code is receives the credit.
    const owningEntity = a.entity;
    const credit = owningEntity ? round2(byEntityFunding.get(owningEntity) ?? 0) : 0;
    return {
      code: a.code,
      name: a.name,
      entity: a.entity,
      currentNet: row.net,
      inboundFundingCredit: credit,
      wouldNet: round2(row.net - credit),
    };
  });
  const groupWouldNet = round2(wouldNet.reduce((s, r) => s + r.wouldNet, 0));

  const mislabelledInboundTotal = round2(
    inbound.filter((l) => l.shouldRouteTo3600).reduce((s, l) => s + l.amount, 0),
  );

  const hygiene = {
    bareLines: balanceRows.reduce((s, r) => s + r.bareLines, 0),
    bareAmount: round2(balanceRows.reduce((s, r) => s + r.bareAmount, 0)),
    selfLines: balanceRows.reduce((s, r) => s + r.selfLines, 0),
    selfAmount: round2(balanceRows.reduce((s, r) => s + r.selfAmount, 0)),
  };

  return {
    start: input.start,
    end: input.end,
    balances: balanceRows,
    groupNet,
    outbound,
    inbound,
    managementFeeInbound: managementFee,
    mislabelledInboundTotal,
    wouldNet,
    groupWouldNet,
    hygiene,
  };
}
