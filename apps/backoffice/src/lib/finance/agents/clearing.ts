// Cash-clearing journal builder (pure).
//
// When a bank line is matched to a receivable/payable, the cash actually moves
// in the GL here — distinct from the revenue/expense recognition the AR/AP
// agents already booked.
//
// AR (bank inflow → invoice): the AR agent debited the channel debtor at NET
// and lumped SST into 1000-02 (see ar.ts DEBTOR map + SST booking). So clearing
// credits back the channel debtor (net portion) AND 1000-02 (SST portion),
// proportional to the matched amount, and debits the bank. This unwinds exactly
// what was booked, leaving the GL correct without touching the AR agent.
//
// AP (bank outflow → bill): the payable (3001) holds the GROSS, so clearing is a
// clean DR payable / CR bank — no split.
//
// `transaction` targets have no standard receivable/payable, so no clearing
// journal is produced (the match is still recorded).

import type { JournalLineInput } from "../types";

const SST_DEBTOR = "1000-02"; // where ar.ts parks SST output debtor (cash on hand)
const PAYABLE = "3001"; // AP payable (gross) — see inbox.ts bill posting

// MUST stay in sync with ar.ts DEBTOR (keyed there by EodChannelSplit key; here
// by the fin_invoices.channel enum string).
const CHANNEL_DEBTOR: Record<string, string> = {
  cash_qr: "1000-02",
  card: "1006",
  voucher: "1007",
  grabfood: "1005",
  gastrohub: "1001-00",
  other: "1000-02",
};

export type ClearingParams = {
  matchedToType: "invoice" | "bill" | "transaction";
  bankAccountCode: string;
  amountMatched: number;
  outletId: string | null;
  // AR invoice split inputs:
  channel?: string | null;
  subtotal?: number | null;
  total?: number | null;
  reference?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildClearingLines(p: ClearingParams): JournalLineInput[] | null {
  if (p.matchedToType === "transaction") return null;
  const amt = round2(p.amountMatched);
  if (amt <= 0) return null;
  const ref = p.reference ? ` ${p.reference}` : "";

  if (p.matchedToType === "bill") {
    // AP: payable (gross) → bank.
    return [
      { accountCode: PAYABLE, outletId: p.outletId ?? null, debit: amt, memo: `AP settlement${ref}` },
      { accountCode: p.bankAccountCode, outletId: p.outletId ?? null, credit: amt, memo: `Bank payment${ref}` },
    ];
  }

  // AR invoice: DR bank / CR channel debtor (net) + CR SST debtor (sst).
  const total = round2(Number(p.total ?? 0));
  const subtotal = round2(Number(p.subtotal ?? total));
  const debtor = CHANNEL_DEBTOR[p.channel ?? "other"] ?? SST_DEBTOR;

  let netPortion = total > 0 ? round2((amt * subtotal) / total) : amt;
  if (netPortion > amt) netPortion = amt;
  const sstPortion = round2(amt - netPortion);

  const lines: JournalLineInput[] = [
    { accountCode: p.bankAccountCode, outletId: p.outletId ?? null, debit: amt, memo: `Settlement received${ref}` },
  ];

  if (debtor === SST_DEBTOR) {
    // Net + SST clear the same account — one combined credit.
    lines.push({ accountCode: SST_DEBTOR, outletId: p.outletId ?? null, credit: amt, memo: `Cash/SST debtor cleared${ref}` });
  } else {
    lines.push({ accountCode: debtor, outletId: p.outletId ?? null, credit: netPortion, memo: `${p.channel} debtor cleared${ref}` });
    if (sstPortion > 0) {
      lines.push({ accountCode: SST_DEBTOR, outletId: p.outletId ?? null, credit: sstPortion, memo: `SST debtor cleared${ref}` });
    }
  }

  return lines;
}
