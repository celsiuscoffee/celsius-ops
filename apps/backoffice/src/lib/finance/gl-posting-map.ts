// Pure mapping + helpers for the bank→GL posting bridge. No DB/IO imports, so it
// is unit-testable and safe to import anywhere. The poster (gl-posting.ts) wires
// these to Prisma + the ledger.

export const BANK_CASH = "1000-01"; // Bank Account (per company via fin_transactions.company_id)
export const SUSPENSE = "1999";     // Suspense / Unclassified — keeps the bank tied out

// GL posting cutover. 2025 books live in Bukku (reconciled through Dec 2025);
// this GL owns 2026 onward with opening balances posted as at the cutover.
// No automated path may post before this date: the bank bridge hard filters
// its candidate lines, the EOD ingestors refuse pre-cutover dates, and the
// salary accrual skips pre-cutover months. This keeps backfill and cron reruns
// from recreating 2025 journals after the balance sheet surgery deletes them.
export const GL_POSTING_CUTOVER = "2026-01-01";

// CashCategory → contra GL account code. The bank line's direction (CR in / DR
// out) decides which side BANK_CASH sits on; the contra always takes the other.
export const CONTRA_ACCOUNT: Record<string, string> = {
  // ── inflows: revenue already accrued by EOD Sales → clear the debtor ──
  CARD: "1006",            // Debit/credit card debtors
  STOREHUB: "1006",        // legacy POS card-style settlement
  QR: "1000-02",           // DuitNow QR / cash banked out of Cash on Hand
  GRAB: "1005",            // Grabfood debtors
  GRAB_PUTRAJAYA: "1999",  // settles into HQ bank but debtor sits in Conezion; CR lines route via resolveGrabSettlementRouting, this fallback only parks odd cases (DR side, or the outlet company's own bank)
  FOODPANDA: "1005",       // marketplace debtor (no separate FP account yet)
  REVENUE_MONSTER: "1000-02", // RM terminal settling pickup/table QR+e-wallet sales already accrued by EOD → clears the Cash & QR debtor (crediting income here double-counted revenue)
  // ── inflows NOT in EOD (B2B / online) → recognise income directly ──
  MEETINGS_EVENTS: "5000-10",
  GASTROHUB: "5000-09",
  REFUND: "6000-01",       // money back from a supplier — reduces COGS
  CUSTOMER_REFUND: "5002", // money paid back to a customer (sales return) — contra-revenue

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
  PARTIMER: "6500-03",     // part-timer wages → expense (Bukku books these direct)
  // EMPLOYEE_SALARY + STATUTORY_PAYMENT are NOT here — they route through
  // CONTROL accounts (3008/3004-3007) in resolveContra(), the way Bukku books
  // them: the bank payment clears a liability the payroll run accrued.
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

// Failed transfers reverse themselves on the statement — never hit the ledger.
export const SKIP_CATS = new Set(["TRANSFER_NOT_SUCCESSFUL"]);

// Resolve the legal entity (fin_companies.id) that owns a bank line, from the
// statement's account name. (…2644) Conezion, (…9345) Tamarind, (…4384) the
// Celsius Coffee SB HQ account that also carries Shah Alam + Nilai.
export function companyFromAccountName(accountName: string | null | undefined): string {
  const a = accountName ?? "";
  if (/CONEZION|2644/i.test(a)) return "celsiusconezion";
  if (/TAMARIND|9345/i.test(a)) return "celsiustamarind";
  return "celsius";
}

// The contra account + whether it is a suspense parking (unmapped category).
export function contraFor(category: string): { code: string; suspense: boolean } {
  if (CONTRA_ACCOUNT[category]) return { code: CONTRA_ACCOUNT[category], suspense: false };
  return { code: SUSPENSE, suspense: true };
}

const INTERCO_CATS = new Set([
  "INTERCO_PEOPLE", "INTERCO_RAW_MATERIAL", "INTERCO_INVESTMENTS", "INTERCO_EXPENSES",
]);

// Which related-company "Due to/from" account an inter-co line belongs to, read
// from the counterparty named in the bank narrative.
function intercoAccount(descUpper: string): string {
  if (/TAMARIND|TAMAR/.test(descUpper)) return "3600-00";
  if (/CONEZION|\bCONE\b/.test(descUpper)) return "3600-01";
  if (/CELSIUS\s*COFFEE\s*SDN|\bCCSB\b/.test(descUpper)) return "3600-02";
  return "3600"; // generic inter-company current account
}

// "Due to/from <entity>" inter-company account keyed by the COUNTERPARTY
// company id. Same accounts intercoAccount() resolves from bank narratives,
// but addressable by fin_companies.id for programmatic routing.
export const INTERCO_DUE_ACCOUNT: Record<string, string> = {
  celsiustamarind: "3600-00",
  celsiusconezion: "3600-01",
  celsius: "3600-02",
};

export const GRAB_DEBTOR = "1005"; // Grabfood debtors (keep aligned with CONTRA_ACCOUNT.GRAB)

// Categories that represent a Grab payout settling into a bank account.
// GRAB_PUTRAJAYA is the legacy hand-applied label for Grab money earned by the
// Putrajaya (Conezion) outlet that settles into the SB account.
export const GRAB_SETTLEMENT_CATS = new Set(["GRAB", "GRAB_PUTRAJAYA"]);

export type GrabSettlementRouting = {
  // Contra credited in the RECEIVING company's journal: due to the outlet's company.
  contra: string;
  // Second journal posted in the OUTLET's company.
  mirror: {
    company: string;       // the outlet's legal entity
    debitAccount: string;  // 3600-xx due from the receiving company
    creditAccount: string; // 1005 Grabfood debtors, cleared where EOD accrued them
  };
};

// Cross-entity Grab settlement routing.
//
// ALL Grab payouts land in Celsius Coffee SB's bank account (4384), including
// money earned by the Putrajaya (Conezion) and Tamarind outlets, while the EOD
// AR agent accrues those sales as Dr 1005 in the OUTLET's company. Crediting
// the receiving company's own 1005 (or parking in suspense) leaves the outlet
// company's 1005 debits uncleared forever and piles phantom credits on SB.
// Instead the settlement posts as TWO balanced journals:
//   receiving company: Dr 1000-01 bank, Cr 3600-xx (due to the outlet's company)
//   outlet's company:  Dr 3600-yy (due from the receiver), Cr 1005 Grabfood debtors
//
// Returns null when the line is not a Grab settlement, when the outlet's
// company cannot be resolved, or when the outlet belongs to the receiving
// company itself. Own-outlet settlements (Shah Alam, Nilai in SB's account)
// keep the plain single-journal behavior: Dr bank, Cr 1005.
export function resolveGrabSettlementRouting(
  category: string,
  bankCompany: string,
  outletCompanyId: string | null,
): GrabSettlementRouting | null {
  if (!GRAB_SETTLEMENT_CATS.has(category)) return null;
  // The GRAB_PUTRAJAYA category itself carries the outlet identity, so lines
  // without a resolved outlet still route to Conezion.
  const outletCompany = outletCompanyId ?? (category === "GRAB_PUTRAJAYA" ? "celsiusconezion" : null);
  if (!outletCompany || outletCompany === bankCompany) return null;
  const dueToOutletCompany = INTERCO_DUE_ACCOUNT[outletCompany];
  const dueFromBankCompany = INTERCO_DUE_ACCOUNT[bankCompany];
  if (!dueToOutletCompany || !dueFromBankCompany) return null;
  return {
    contra: dueToOutletCompany,
    mirror: {
      company: outletCompany,
      debitAccount: dueFromBankCompany,
      creditAccount: GRAB_DEBTOR,
    },
  };
}

// Resolve the contra account for a bank line — the accurate version that mirrors
// how Bukku books things, using the description where the category alone is too
// coarse:
//   • EMPLOYEE_SALARY  → 3008 Salary Control          (cleared by payroll accrual)
//   • STATUTORY_PAYMENT→ 3004/3005/3006/3007 by type  (EPF/SOCSO/EIS/PCB control)
//   • INTERCO_*        → 3600-xx Due to/from <entity>  (not suspense)
//   • everything else  → the static CONTRA_ACCOUNT map
// A few categories mean different things depending on which way the money went.
// The management fee is the clear case: an outlet PAYING it is an expense
// (6511-06), but HQ RECEIVING it is income. Crediting the same expense account
// on the way in made HQ's P&L show a negative expense instead of revenue, which
// understated both income and expense by the same amount and made the GL
// impossible to compare with the sourced P&L (which books it as REV-MGMT).
const INFLOW_CONTRA: Record<string, string> = {
  MANAGEMENT_FEE: "5501", // Management fee income
};

/** Contra for a bank line, given its direction. Inflows can differ — see INFLOW_CONTRA. */
export function resolveContraDirectional(
  category: string,
  description: string,
  direction: "CR" | "DR",
): { code: string; suspense: boolean } {
  if (direction === "CR" && INFLOW_CONTRA[category]) {
    return { code: INFLOW_CONTRA[category], suspense: false };
  }
  return resolveContra(category, description);
}

export function resolveContra(category: string, description: string): { code: string; suspense: boolean } {
  const d = (description || "").toUpperCase();
  if (category === "EMPLOYEE_SALARY") return { code: "3008", suspense: false };
  if (category === "STATUTORY_PAYMENT") {
    if (/\bEPF\b|KWSP/.test(d)) return { code: "3004", suspense: false };
    if (/SOCSO|PERKESO/.test(d)) return { code: "3005", suspense: false };
    if (/\bEIS\b|\bSIP\b/.test(d)) return { code: "3006", suspense: false };
    if (/\bPCB\b|\bMTD\b|LHDN|HASIL|INLAND\s*REVENUE/.test(d)) return { code: "3007", suspense: false };
    return { code: "3008", suspense: false }; // unspecified statutory → salary control
  }
  if (INTERCO_CATS.has(category)) return { code: intercoAccount(d), suspense: false };
  return contraFor(category);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
