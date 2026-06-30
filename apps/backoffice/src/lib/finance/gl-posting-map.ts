// Pure mapping + helpers for the bank→GL posting bridge. No DB/IO imports, so it
// is unit-testable and safe to import anywhere. The poster (gl-posting.ts) wires
// these to Prisma + the ledger.

export const BANK_CASH = "1000-01"; // Bank Account (per company via fin_transactions.company_id)
export const SUSPENSE = "1999";     // Suspense / Unclassified — keeps the bank tied out

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

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
