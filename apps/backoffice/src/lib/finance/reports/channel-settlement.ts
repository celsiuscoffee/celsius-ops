// Channel settlement reconciliation. Strictly READ-ONLY: it reads the posted GL
// (fin_journal_lines joined fin_transactions) for the three channel debtor
// accounts, per company and per month, and separates the debtor residual into
// its three known causes so the owner can see why the debtors do not clear to
// zero before any clearing journals are posted.
//
// Sales are accrued as a DEBIT to a channel debtor (Card 1006, Grab 1005,
// Cash & QR 1000-02); bank settlements CREDIT it. The residual (Dr minus Cr)
// splits into:
//   1) MISATTRIBUTION: the settlement cash arrives under a different channel
//      label than the sale was accrued under, so per-channel gaps are noisy and
//      the ENTITY NET across all three debtors is the meaningful figure.
//   2) COMMISSION: Grab and card take commission BEFORE payout, so a debtor
//      accrued at GROSS only ever receives NET cash. Already expensed
//      (MKT-GRAB-COMM in the sourced P&L, card MDR as BANK_FEE 6514), this is
//      the expected permanent portion. Surfaced per channel.
//   3) TIMING: recent sales not yet settled. Whatever remains after 1 and 2.
//
// This report does NOT classify, retag or post any journal. The clearing
// actions (retag misattributed settlements, post commission clearing) are a
// deliberate follow-up, not built here.

import { effectiveGrabRate } from "./pnl-sourced";
import { pagedPostedTxns, pagedJournalLines } from "./paged";

function round2(n: number): number { return Math.round(n * 100) / 100; }

// The channel debtor accounts, in display order. Kept aligned with
// CONTRA_ACCOUNT in gl-posting-map.ts.
const DEBTORS: { code: string; label: string; commission: "grab" | "card" | "none" }[] = [
  { code: "1006", label: "Card", commission: "card" },
  { code: "1005", label: "GrabFood", commission: "grab" },
  { code: "1000-02", label: "Cash & QR", commission: "none" },
];

// Card MDR / bank merchant fees account. Grab commission is netted before
// payout (never in the bank feed) and is estimated via effectiveGrabRate.
const BANK_FEE_ACCOUNT = "6514";

const DEBTOR_CODES = DEBTORS.map((d) => d.code);

export type ChannelMonth = {
  month: string;
  accrued: number;
  settled: number;
  residual: number;
  commission: number;
  residualAfterCommission: number;
};

export type ChannelRow = {
  code: string;
  label: string;
  accrued: number;
  settled: number;
  residual: number;
  commission: number;
  residualAfterCommission: number;
  months: ChannelMonth[];
};

export type CompanyChannelSettlement = {
  companyId: string;
  companyName: string;
  channels: ChannelRow[];
  // Entity net = total across the three debtors of (accrued minus settled).
  // This is the true unreconciled figure since per-channel splits are noisy.
  entityNet: number;
  totalCommission: number;
  entityNetAfterCommission: number;
};

export type ChannelSettlementReport = {
  start: string;
  end: string;
  companies: CompanyChannelSettlement[];
  consolidated: {
    channels: ChannelRow[];
    entityNet: number;
    totalCommission: number;
    entityNetAfterCommission: number;
  };
};

type Company = { id: string; name: string };

// Debit/credit per debtor account per month, for one company, read straight
// from the posted GL and paged (Supabase caps unpaged selects at 1000 rows).
async function debtorMovementsByCompany(
  companyIds: string[],
  end: string,
  startMonth: string,
): Promise<Map<string, Map<string, Map<string, { d: number; c: number }>>>> {
  // company -> account -> month -> { debit, credit }
  const out = new Map<string, Map<string, Map<string, { d: number; c: number }>>>();
  for (const cid of companyIds) {
    const { txnIds, txnDate } = await pagedPostedTxns([cid], end);
    const byAcct = new Map<string, Map<string, { d: number; c: number }>>();
    for (const code of DEBTOR_CODES) byAcct.set(code, new Map());
    for await (const lines of pagedJournalLines(txnIds)) {
      for (const l of lines) {
        if (!DEBTOR_CODES.includes(l.account_code)) continue;
        const date = txnDate.get(l.transaction_id);
        if (!date) continue;
        const month = date.slice(0, 7);
        if (month < startMonth) continue;
        const byMonth = byAcct.get(l.account_code);
        if (!byMonth) continue;
        const cur = byMonth.get(month) ?? { d: 0, c: 0 };
        cur.d = round2(cur.d + Number(l.debit));
        cur.c = round2(cur.c + Number(l.credit));
        byMonth.set(month, cur);
      }
    }
    out.set(cid, byAcct);
  }
  return out;
}

// Card MDR (BANK_FEE 6514) debited per company per month, from the posted GL.
async function bankFeesByCompany(
  companyIds: string[],
  end: string,
  startMonth: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const cid of companyIds) {
    const { txnIds, txnDate } = await pagedPostedTxns([cid], end);
    const byMonth = new Map<string, number>();
    for await (const lines of pagedJournalLines(txnIds)) {
      for (const l of lines) {
        if (l.account_code !== BANK_FEE_ACCOUNT) continue;
        const date = txnDate.get(l.transaction_id);
        if (!date) continue;
        const month = date.slice(0, 7);
        if (month < startMonth) continue;
        byMonth.set(month, round2((byMonth.get(month) ?? 0) + Number(l.debit) - Number(l.credit)));
      }
    }
    out.set(cid, byMonth);
  }
  return out;
}

// Build one company's channel rows. Commission is estimated per month:
//   Grab: effectiveGrabRate (global, payout-derived) times that month's gross
//         Grab accrual (the debits to 1005), the same gross the P&L commission
//         line is applied to.
//   Card: the card MDR (BANK_FEE 6514) booked for the company that month.
//   Cash & QR: zero (no commission on QR or cash).
function buildChannels(
  byAcct: Map<string, Map<string, { d: number; c: number }>>,
  bankFees: Map<string, number>,
  grabRate: number,
): ChannelRow[] {
  return DEBTORS.map((debtor) => {
    const byMonth = byAcct.get(debtor.code) ?? new Map();
    const monthKeys = new Set<string>([...byMonth.keys()]);
    if (debtor.commission === "card") for (const m of bankFees.keys()) monthKeys.add(m);
    const months: ChannelMonth[] = [...monthKeys].sort((a, b) => a.localeCompare(b)).map((month) => {
      const v = byMonth.get(month) ?? { d: 0, c: 0 };
      const accrued = round2(v.d);
      const settled = round2(v.c);
      const residual = round2(accrued - settled);
      let commission = 0;
      if (debtor.commission === "grab") commission = round2(accrued * grabRate);
      else if (debtor.commission === "card") commission = round2(bankFees.get(month) ?? 0);
      return {
        month, accrued, settled, residual, commission,
        residualAfterCommission: round2(residual - commission),
      };
    });
    const accrued = round2(months.reduce((s, m) => s + m.accrued, 0));
    const settled = round2(months.reduce((s, m) => s + m.settled, 0));
    const residual = round2(accrued - settled);
    const commission = round2(months.reduce((s, m) => s + m.commission, 0));
    return {
      code: debtor.code, label: debtor.label,
      accrued, settled, residual, commission,
      residualAfterCommission: round2(residual - commission),
      months,
    };
  });
}

function summarise(channels: ChannelRow[]) {
  const entityNet = round2(channels.reduce((s, c) => s + c.residual, 0));
  const totalCommission = round2(channels.reduce((s, c) => s + c.commission, 0));
  return { entityNet, totalCommission, entityNetAfterCommission: round2(entityNet - totalCommission) };
}

// Consolidate per-channel rows across companies (sum accrued/settled/commission
// per debtor and per month).
function consolidateChannels(perCompany: CompanyChannelSettlement[]): ChannelRow[] {
  return DEBTORS.map((debtor) => {
    const monthAgg = new Map<string, { accrued: number; settled: number; commission: number }>();
    for (const co of perCompany) {
      const row = co.channels.find((c) => c.code === debtor.code);
      if (!row) continue;
      for (const m of row.months) {
        const cur = monthAgg.get(m.month) ?? { accrued: 0, settled: 0, commission: 0 };
        cur.accrued = round2(cur.accrued + m.accrued);
        cur.settled = round2(cur.settled + m.settled);
        cur.commission = round2(cur.commission + m.commission);
        monthAgg.set(m.month, cur);
      }
    }
    const months: ChannelMonth[] = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => {
      const residual = round2(v.accrued - v.settled);
      return {
        month, accrued: v.accrued, settled: v.settled, residual, commission: v.commission,
        residualAfterCommission: round2(residual - v.commission),
      };
    });
    const accrued = round2(months.reduce((s, m) => s + m.accrued, 0));
    const settled = round2(months.reduce((s, m) => s + m.settled, 0));
    const residual = round2(accrued - settled);
    const commission = round2(months.reduce((s, m) => s + m.commission, 0));
    return {
      code: debtor.code, label: debtor.label,
      accrued, settled, residual, commission,
      residualAfterCommission: round2(residual - commission),
      months,
    };
  });
}

export async function buildChannelSettlement(input: {
  start: string;
  end: string;
  companies: Company[];
}): Promise<ChannelSettlementReport> {
  const startMonth = input.start.slice(0, 7);
  const companyIds = input.companies.map((c) => c.id);

  // Global, payout-derived Grab commission rate (same source the sourced P&L
  // uses). One rate for the whole period end.
  const grabRate = (await effectiveGrabRate(input.end)).rate;

  const movements = await debtorMovementsByCompany(companyIds, input.end, startMonth);
  const bankFees = await bankFeesByCompany(companyIds, input.end, startMonth);

  const companies: CompanyChannelSettlement[] = input.companies.map((co) => {
    const byAcct = movements.get(co.id) ?? new Map();
    const fees = bankFees.get(co.id) ?? new Map();
    const channels = buildChannels(byAcct, fees, grabRate);
    const s = summarise(channels);
    return { companyId: co.id, companyName: co.name, channels, ...s };
  });

  const consolidatedChannels = consolidateChannels(companies);
  const consolidated = { channels: consolidatedChannels, ...summarise(consolidatedChannels) };

  return { start: input.start, end: input.end, companies, consolidated };
}
