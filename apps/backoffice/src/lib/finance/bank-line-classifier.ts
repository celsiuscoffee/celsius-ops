// Auto-classifier for bank statement lines. Maps a transaction description
// (and amount, direction, account) to one of the CashCategory buckets used
// by the cash-tracking spreadsheet framework.
//
// Rules are ordered by specificity — first match wins. Each rule returns a
// category, optional outlet hint, optional InterCo flag. Description is
// pre-trimmed and uppercased before matching.
//
// Coverage target: ~80% of Maybank current-account transactions on the
// first pass. The remaining 20% — usually one-off vendor payments — are
// expected to be hand-classified via the cash-tracking edit UI.

import type { CashCategory } from "@celsius/db";

type Direction = "CR" | "DR";

export type ClassifyInput = {
  description: string;
  reference?: string | null;
  amount: number;
  direction: Direction;
  // Account this line came from. Used as a fallback for outlet inference
  // when the description doesn't carry an outlet prefix (e.g. EPF Payment).
  accountKey?: string;
};

export type ClassifyResult = {
  category: CashCategory | null;
  outletCode: string | null;   // resolved to outletId by the caller
  isInterCo: boolean;
  ruleName: string;
};

// Outlet-prefix conventions in Maybank descriptions:
//   "CelsiusCoffee SA" / "CELSIUSCOFFEE SA"   → Shah Alam
//   "CelsiusCoffee N"                          → Nilai
//   "CelsiusCoffee P" / "CONEZION PUTRAJAYA"   → Conezion (Putrajaya)
//   "CelsiusCoffee C" / "CELSIUSCOFFEE C"      → Conezion
//   "CelsiusCoffee T" / "TAMARIND"             → Tamarind
//   No prefix or "CelsiusCoffee" alone          → HQ-level / unattributed
//
// Outlet codes returned here match the Outlet.code values used elsewhere.
function inferOutlet(desc: string): string | null {
  if (/\bTAMARIND\b/i.test(desc) || /\bCELSIUSCOFFEE\s*T\b/i.test(desc)) return "CC003";
  if (/\bCONEZION\b/i.test(desc) || /\bCELSIUSCOFFEE\s*C\b/i.test(desc)) return "CC001";
  if (/\bCELSIUSCOFFEE\s*SA\b/i.test(desc)) return null;       // Shah Alam — outlet code unknown to me
  if (/\bCELSIUSCOFFEE\s*N\b/i.test(desc)) return null;        // Nilai — same
  if (/\bCELSIUSCOFFEE\s*P\b/i.test(desc)) return "CC001";     // Putrajaya = Conezion in current data
  return null;
}

type Rule = {
  name: string;
  // Match on description (case-insensitive) — string substring or regex.
  match: RegExp;
  // Optional direction filter — only apply when transaction is CR or DR.
  direction?: Direction;
  category: CashCategory;
  isInterCo?: boolean;
};

// Inflow rules
const INFLOW_RULES: Rule[] = [
  // InterCo inbound — credit from another Celsius entity. Match BEFORE
  // generic vendor rules so internal transfers don't get classified as
  // sales or other revenue. Match only the full entity names
  // ("CELSIUS COFFEE SDN", "...CONEZION", "...TAMARIND") — these are the
  // legal entities, not the outlet prefixes ("CelsiusCoffee SA" etc).
  { name: "interco_in_celsius_entity", match: /\bCELSIUS\s*COFFEE\s+(SDN|CONEZION|TAMARIND)\b/i, direction: "CR", category: "INTERCO_PEOPLE" as CashCategory, isInterCo: true },

  // QR — DuitNow QR transactions. Two formats:
  //   "DUITNOW QR-         <NAME>"
  //   "<7-digit>Q                             *<long ref>"
  { name: "qr_duitnow_named", match: /\bDUITNOW QR\b/i, direction: "CR", category: "QR" as CashCategory },
  { name: "qr_qcode",         match: /\b\d{7,}Q\b/,     direction: "CR", category: "QR" as CashCategory },

  // Card — "DR/CARD SALES M/N <ref>" — debit/credit terminal settlements
  { name: "card_terminal", match: /\bDR\/?CARD\s*SALES?\b/i, direction: "CR", category: "CARD" as CashCategory },
  // GHL terminal settlement — "IBG TRANSACTION DMS A3 (FOR GHL)"
  { name: "card_ghl_settlement", match: /\bDMS\s*A3\b.*\bGHL\b|\bFOR\s*GHL\b/i, direction: "CR", category: "CARD" as CashCategory },

  // StoreHub — Interbank GIRO from STOREHUB SDN BHD
  { name: "storehub", match: /\bSTOREHUB\b/i, direction: "CR", category: "STOREHUB" as CashCategory },

  // Grab — GPAY NETWORK / GRAB
  { name: "grab", match: /\b(GPAY NETWORK|GRAB(?!FOOD))\b/i, direction: "CR", category: "GRAB" as CashCategory },

  // Foodpanda — DELIVERY HERO / FOODPANDA / DH MALAYSIA
  { name: "foodpanda", match: /\b(FOODPANDA|DELIVERY HERO|DH MALAYSIA)\b/i, direction: "CR", category: "FOODPANDA" as CashCategory },

  // GastroHub — GYRO GASTRO SDN BHD weekly settlement
  { name: "gastrohub", match: /\bGYRO\s*GASTRO\b/i, direction: "CR", category: "GASTROHUB" as CashCategory },

  // Meetings & Events — KIDDYTOPIA, EVENT, CATERING, etc.
  { name: "meetings_kiddytopia", match: /\bKIDDYTOPIA\b/i, direction: "CR", category: "MEETINGS_EVENTS" as CashCategory },
];

// Outflow rules
const OUTFLOW_RULES: Rule[] = [
  // InterCo outbound — payment to another Celsius entity. Match BEFORE
  // vendor rules so internal transfers don't get tagged as RAW_MATERIALS
  // or similar. Restrict to the full entity names
  // ("CELSIUS COFFEE SDN", "...CONEZION", "...TAMARIND") — outlet
  // prefixes alone don't qualify.
  { name: "interco_out_celsius_entity", match: /\bCELSIUS\s*COFFEE\s+(SDN|CONEZION|TAMARIND)\b/i, direction: "DR", category: "INTERCO_PEOPLE" as CashCategory, isInterCo: true },

  // Statutory — EPF / SOCSO / EIS / KWSP / PERKESO / LHDN tax
  { name: "statutory_epf",   match: /\b(EPF|KWSP|M2UBEPF)\b/i,            direction: "DR", category: "STATUTORY_PAYMENT" as CashCategory },
  { name: "statutory_socso", match: /\b(SOCSO|PERKESO|SIP)\b/i,            direction: "DR", category: "STATUTORY_PAYMENT" as CashCategory },
  { name: "tax_lhdn",        match: /\b(LHDN|INLAND REVENUE|HASIL)\b/i,    direction: "DR", category: "TAX" as CashCategory },

  // Rent — known landlords. Add to this list as new outlets onboard.
  { name: "rent_tujuan_gemilang",     match: /\bTUJUAN\s*GEMILANG\b/i,    direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_mayang_development",  match: /\bMAYANG\s*DEVELOPMENT\b/i, direction: "DR", category: "RENT" as CashCategory },
  // Generic property-management hints
  { name: "rent_properties_sdn_bhd",  match: /\bPROPERTIES\s*SDN\s*BHD\b/i, direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_holdings_sdn_bhd",    match: /\bHOLDINGS\s*SDN\s*BHD\b/i,   direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_hartanah",            match: /\bHARTANAH\b/i,               direction: "DR", category: "RENT" as CashCategory },

  // Utilities — TNB / AIR / IWK / TM / MAXIS / DIGI / UNIFI
  { name: "util_tnb",       match: /\bTNB\b|\bTENAGA NASIONAL\b/i, direction: "DR", category: "UTILITIES" as CashCategory },
  { name: "util_water",     match: /\b(AIR\s+(SELANGOR|PUTRAJAYA|JOHOR|MELAKA)|INDAH WATER|IWK)\b/i, direction: "DR", category: "UTILITIES" as CashCategory },
  { name: "util_telco",     match: /\b(MAXIS|DIGI|UNIFI|TM\s|CELCOM|U MOBILE)\b/i, direction: "DR", category: "UTILITIES" as CashCategory },

  // Software / SaaS subscriptions
  { name: "software_saas",  match: /\b(GOOGLE|MICROSOFT|ADOBE|FIGMA|NOTION|SLACK|ZOOM|AWS|VERCEL|CLAUDE|ANTHROPIC|OPENAI)\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },
  { name: "software_pos",   match: /\b(STOREHUB|XERO|BUKKU|QUICKBOOKS|HUBSPOT)\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },

  // Loan repayments
  { name: "loan_payment",   match: /\b(LOAN\s*PAYMENT|FINANCING|HIRE\s*PURCHASE)\b/i, direction: "DR", category: "LOAN" as CashCategory },

  // Bank fees
  { name: "bank_fee",       match: /\b(SERVICE\s*FEE|HANDLING\s*FEE|BANK\s*CHARGE|MAINTENANCE\s*FEE|GIRO\s*FEE)\b/i, direction: "DR", category: "BANK_FEE" as CashCategory },

  // Marketing — Digital Ads, KOL, content
  { name: "marketing_digital_ads_meta",  match: /\b(META PLATFORMS|FACEBOOK|INSTAGRAM)\b/i, direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  { name: "marketing_digital_ads_google",match: /\bGOOGLE\s*ADS\b/i,         direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  { name: "marketing_pxl",               match: /\bPXL\s*MARKETING\b/i,       direction: "DR", category: "DIGITAL_ADS" as CashCategory },

  // Marketplace fees — GrabFood / FP commissions
  { name: "marketplace_grab_fee",        match: /\bGRABFOOD\s*COMMISSION\b/i, direction: "DR", category: "MARKETPLACE_FEE" as CashCategory },

  // Partimer payouts — descriptions usually contain "PT Week" or "Partimer"
  { name: "partimer",       match: /\bPT\s*WEEK\b|\bPARTIMER\b/i, direction: "DR", category: "PARTIMER" as CashCategory },

  // Employee Salary — descriptions like "Salary Nov", "SCC_11/25", direct salary transfers
  { name: "salary_explicit",match: /\bSALARY\b/i,                  direction: "DR", category: "EMPLOYEE_SALARY" as CashCategory },
  { name: "salary_scc",     match: /\bSCC[_ ]\d+\/\d+\b/i,         direction: "DR", category: "EMPLOYEE_SALARY" as CashCategory },

  // Directors Allowance — RM 40,000 to Ammar Bin Shahrin (per Apr 2026 pattern)
  { name: "directors_ammar",match: /\bAMMAR\s*BIN\s*SHAHRIN\b/i,  direction: "DR", category: "DIRECTORS_ALLOWANCE" as CashCategory },

  // Raw Materials — known F&B suppliers (extend as new vendors onboard)
  { name: "raw_aryzta",      match: /\bARYZTA\b/i,                 direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_erul",        match: /\bERUL\s*FOOD\b/i,            direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_tmm",         match: /\bTMM\s*RESOURCES\b/i,        direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_nyc",         match: /\bNYC\s*TREATS\b/i,           direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_global_coffee",match: /\bGLOBAL\s*COFFEE\b/i,       direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_js_breadserie",match: /\bJS\s*BREADSERIE\b/i,       direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_365eat",      match: /\b365EAT\s*FOOD\b/i,          direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_dankoff",     match: /\bDANKOFF\b/i,                direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_blancoz",     match: /\bBLANCOZ\b/i,                direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_yow_seng",    match: /\bYOW\s*SENG\b/i,             direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_milk_moka",   match: /\bMILK\s*&\s*MOKA\b/i,        direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_collective",  match: /\bCOLLECTIVE\s*PROJECT\b/i,   direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_rosyam",      match: /\bROSYAM\s*MART\b/i,          direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_catelux",     match: /\bCATELUX\b/i,                direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_poket_capital",match: /\bPOKET\s*CAPITAL\b/i,       direction: "DR", category: "RAW_MATERIALS" as CashCategory },

  // Generic SDN BHD vendor (lowest priority — fires only after the named
  // vendor list above has missed). Marked OTHER_OUTFLOW so finance can
  // re-classify; safer than guessing RAW_MATERIALS.
  { name: "vendor_sdn_bhd",  match: /\bSDN\.?\s*BHD\b/i,           direction: "DR", category: "OTHER_OUTFLOW" as CashCategory },
];

export function classifyBankLine(input: ClassifyInput): ClassifyResult {
  const desc = input.description ?? "";
  const norm = desc.toUpperCase().replace(/\s+/g, " ").trim();

  const rules = input.direction === "CR" ? INFLOW_RULES : OUTFLOW_RULES;
  for (const rule of rules) {
    if (rule.direction && rule.direction !== input.direction) continue;
    if (rule.match.test(norm)) {
      return {
        category: rule.category,
        outletCode: inferOutlet(desc),
        isInterCo: rule.isInterCo ?? false,
        ruleName: rule.name,
      };
    }
  }

  return {
    category: input.direction === "CR" ? ("OTHER_INFLOW" as CashCategory) : ("OTHER_OUTFLOW" as CashCategory),
    outletCode: inferOutlet(desc),
    isInterCo: false,
    ruleName: "fallback_other",
  };
}
