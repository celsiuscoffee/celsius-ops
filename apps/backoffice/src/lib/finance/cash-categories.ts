// The human-assignable bank categories + their COA labels — one source of truth
// shared by the Reconciliation page and the Reports drill-down (so a category
// added in one place shows in the other). Mirrors the CashCategory enum;
// validated server-side by the classify endpoint.

import { CONTRA_ACCOUNT } from "./gl-posting-map";

// Inter-company: one entity paid for / funded another's cost. Booking both
// mirror legs to the "Due to/from" control accounts (3600-xx, routed by
// counterparty) offsets them — P&L untouched, eliminated on consolidation.
export const INTERCO_CATEGORIES = [
  "INTERCO_EXPENSES", "INTERCO_INVESTMENTS", "INTERCO_RAW_MATERIAL", "INTERCO_PEOPLE",
] as const;

export const OUTFLOW_CATEGORIES = [
  "RAW_MATERIALS", "RENT", "UTILITIES", "MAINTENANCE", "EQUIPMENTS", "SOFTWARE",
  "STAFF_CLAIM", "PARTIMER", "EMPLOYEE_SALARY", "STATUTORY_PAYMENT", "TAX",
  "COMPLIANCE", "LICENSING_FEE", "BANK_FEE", "MARKETPLACE_FEE", "OTHER_MARKETING",
  "KOL", "DELIVERY", "PETTY_CASH", "LOAN", "DIVIDEND", "DIRECTORS_ALLOWANCE",
  "CAPITAL", "INVESTMENTS", "MANAGEMENT_FEE", "CFS_FEE", "CUSTOMER_REFUND",
  ...INTERCO_CATEGORIES,
] as const;

export const INFLOW_CATEGORIES = [
  "QR", "CARD", "GRAB", "STOREHUB", "FOODPANDA", "REVENUE_MONSTER",
  "GASTROHUB", "MEETINGS_EVENTS", "REFUND", "LOAN", "CAPITAL",
  "MANAGEMENT_FEE", "EMPLOYEE_SALARY", "STATUTORY_PAYMENT",
  ...INTERCO_CATEGORIES,
] as const;

// Control-account routes that CONTRA_ACCOUNT doesn't carry (resolveContra does):
// salary/statutory controls, and the inter-company Due-to/from account (3600-xx
// by counterparty — the label shows the parent 3600).
export const CONTROL_COA: Record<string, string> = {
  EMPLOYEE_SALARY: "3008", STATUTORY_PAYMENT: "3004-7",
  INTERCO_EXPENSES: "3600", INTERCO_INVESTMENTS: "3600", INTERCO_RAW_MATERIAL: "3600", INTERCO_PEOPLE: "3600",
};

export function categoryLabel(c: string, accountNames: Map<string, string>): string {
  const code = CONTRA_ACCOUNT[c] ?? CONTROL_COA[c];
  const name = code ? accountNames.get(code) : undefined;
  const human = c.toLowerCase().replace(/_/g, " ");
  return code ? `${human} → ${code}${name ? ` ${name}` : ""}` : human;
}

// Compact form for inline chips: category plus COA code, no account name.
export function categoryChipLabel(c: string | null | undefined): string {
  if (!c) return "unclassified";
  const code = CONTRA_ACCOUNT[c] ?? CONTROL_COA[c];
  const human = c.toLowerCase().replace(/_/g, " ");
  return code ? `${human} · ${code}` : human;
}
