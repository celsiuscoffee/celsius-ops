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
  // Normalized supplier names from the procurement registry (uppercased,
  // single-spaced). When the rules miss on an outflow, a description containing
  // one of these classifies as RAW_MATERIALS — so onboarding a supplier in
  // procurement is enough for their payments to classify, no rule edit needed.
  vendorHints?: string[];
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
  // Channel-specific outlets (both in Celsius Coffee SB / acct 4384):
  // GastroHub settles for Nilai; Kiddytopia is the IOI Mall events venue.
  if (/\bGYRO\s*GASTRO\b/i.test(desc)) return "CF Nilai";
  if (/\bKIDDYTOPIA\b/i.test(desc)) return "CF IOI Mall";
  if (/\bTAMARIND\b/i.test(desc) || /\bCELSIUSCOFFEE\s*T\b/i.test(desc)) return "CC003";
  if (/\bCONEZION\b/i.test(desc) || /\bCELSIUSCOFFEE\s*C\b/i.test(desc)) return "CC001";
  if (/\bCELSIUSCOFFEE\s*SA\b/i.test(desc)) return "CC002";    // Shah Alam
  if (/\bCELSIUSCOFFEE\s*N\b/i.test(desc)) return "CF Nilai";  // Nilai
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
//
// InterCo policy: a transfer whose COUNTERPARTY is another Celsius entity is
// flagged InterCo — internal group movement, regardless of purpose (applied in
// classifyBankLine via INTERCO_COUNTERPARTY). The purpose-based rules below
// still set the category so the P&L can attribute the underlying spend; some
// also pre-set isInterCo for classic management-fee / capital washes.

const INFLOW_RULES: Rule[] = [

  // QR — DuitNow QR transactions. Two formats:
  //   "DUITNOW QR-         <NAME>"
  //   "<7-digit>Q                             *<long ref>"
  { name: "qr_duitnow_named", match: /\bDUITNOW QR\b/i, direction: "CR", category: "QR" as CashCategory },
  { name: "qr_qcode",         match: /\b\d{7,}Q\b/,     direction: "CR", category: "QR" as CashCategory },

  // Card — Maybank shows terminal settlements as both "DR/CARD SALES"
  // (debit-card) and "CR/CARD SALES" (credit-card). Both are CR-side
  // (money in) on our statement; the DR/CR prefix in the description
  // refers to the cardholder's card type, not our direction. Match
  // either prefix.
  { name: "card_terminal", match: /\b(?:DR|CR)\/?CARD\s*SALES?\b/i, direction: "CR", category: "CARD" as CashCategory },
  // GHL terminal settlement — "IBG TRANSACTION DMS A3 (FOR GHL)"
  { name: "card_ghl_settlement", match: /\bDMS\s*A3\b.*\bGHL\b|\bFOR\s*GHL\b/i, direction: "CR", category: "CARD" as CashCategory },

  // Inflow suffix rules — "TRANSFER TO A/C <party> * <purpose>" pattern.
  // Like the outflow side, the prefix is just routing; the suffix tells
  // us why money came in.
  { name: "in_loan_repayment",     match: /\bLOAN\b/i,                               direction: "CR", category: "LOAN" as CashCategory },
  { name: "in_management_fee",     match: /\bMANAGEMENT\s*FEE|\bMNGMT\s*FEE\b/i,     direction: "CR", category: "MANAGEMENT_FEE" as CashCategory, isInterCo: true },
  { name: "in_salary_return",      match: /\bSALARY\b/i,                             direction: "CR", category: "EMPLOYEE_SALARY" as CashCategory, isInterCo: true },
  { name: "in_stat_pay_return",    match: /\b(STAT\s*PAY|STATUTORY)\b/i,             direction: "CR", category: "STATUTORY_PAYMENT" as CashCategory, isInterCo: true },
  { name: "in_inventory_return",   match: /\bINVENTORY\b/i,                          direction: "CR", category: "RAW_MATERIALS" as CashCategory, isInterCo: true },
  { name: "in_capital_injection",  match: /\bCAPITAL\s*(INJECTION|TRANSFER)\b/i,     direction: "CR", category: "CAPITAL" as CashCategory },
  { name: "in_chq_deposit",        match: /\bCHQ\s*DEP\b|\bCHEQUE\s*DEPOSIT\b/i,     direction: "CR", category: "OTHER_INFLOW" as CashCategory },
  // Money back: supplier overpayment refunds, GIRO returns of our own
  // transfers, and anything marked overpay (per owner: its own bucket).
  { name: "in_refund",             match: /\bREFUND\b|RETURN\s*CREDIT|OVERPAY/i,        direction: "CR", category: "REFUND" as CashCategory },

  // StoreHub — Interbank GIRO from STOREHUB SDN BHD
  { name: "storehub", match: /\bSTOREHUB\b/i, direction: "CR", category: "STOREHUB" as CashCategory },

  // Revenue Monster — online (pickup + table-QR) settlement. Description is
  // "<DDMMYY> SETTLEMENT REVENUE MONSTER SDN*RMSB SETTLEMENT" where DDMMYY is
  // the sales date being settled (the bank txnDate is the later clearing date).
  { name: "revenue_monster", match: /\bREVENUE\s*MONSTER\b|\bRMSB\s*SETTLEMENT\b/i, direction: "CR", category: "REVENUE_MONSTER" as CashCategory },

  // Grab — GPAY NETWORK / GRAB
  // No leading \b on GPAY: Grab's daily payouts glue the merchant id straight
  // onto the name ("1575371GPAY NETWORK (M) SDN"), which a word boundary rejects.
  { name: "grab", match: /GPAY\s*NETWORK|\bGRAB(?!FOOD)\b/i, direction: "CR", category: "GRAB" as CashCategory },

  // Foodpanda — DELIVERY HERO / FOODPANDA / DH MALAYSIA
  { name: "foodpanda", match: /\b(FOODPANDA|DELIVERY HERO|DH MALAYSIA)\b/i, direction: "CR", category: "FOODPANDA" as CashCategory },

  // GastroHub — GYRO GASTRO SDN BHD weekly settlement
  { name: "gastrohub", match: /\bGYRO\s*GASTRO\b/i, direction: "CR", category: "GASTROHUB" as CashCategory },

  // Meetings & Events — KIDDYTOPIA, EVENT, CATERING, etc.
  { name: "meetings_kiddytopia", match: /\bKIDDYTOPIA\b/i, direction: "CR", category: "MEETINGS_EVENTS" as CashCategory },
];

// Outflow rules
//
// As above — counterparty-based InterCo is applied in classifyBankLine via
// INTERCO_COUNTERPARTY. The purpose verbs below still drive the category and
// pre-flag the classic management-fee / asset-transfer / capital washes.
const OUTFLOW_RULES: Rule[] = [
  // True InterCo — management fees, asset transfers, capital injections
  // between Celsius entities. These genuinely net to zero across
  // consolidation. Match by purpose verb, not entity name.
  { name: "interco_management_fee", match: /\bMANAGEMENT\s*FEE\b|\bMNGMT\s*FEE\b/i, direction: "DR", category: "MANAGEMENT_FEE" as CashCategory, isInterCo: true },
  { name: "interco_asset_transfer", match: /\bASSET\s*TRANSFER\b/i, direction: "DR", category: "INTERCO_INVESTMENTS" as CashCategory, isInterCo: true },
  { name: "interco_capital",        match: /\bCAPITAL\s*(INJECTION|TRANSFER)\b/i, direction: "DR", category: "CAPITAL" as CashCategory, isInterCo: true },
  { name: "interco_return_mngmt",   match: /\bRETURN\s*MNGMT\b|\bRETURN\s*MANAGEMENT\b/i, direction: "DR", category: "MANAGEMENT_FEE" as CashCategory, isInterCo: true },

  // Suffix-based reclassification for Maybank's "TRANSFER FR A/C
  // CELSIUS COFFEE SDN.* <purpose>" pattern. The leading entity name
  // is just routing; the meaningful info is in the suffix. Match the
  // actual purpose so these end up in real categories.
  //
  // Google Ads is fronted personally by the director (Ammar) and reimbursed as
  // an "Ads claim"/"Google Ads" transfer. The ACTUAL spend is already booked
  // from the ads module (ads_metric_daily), so these reimbursements must land
  // in DIGITAL_ADS = deduped out of bank opex (else double-count). This MUST
  // come before purpose_staff_claim (/CLAIM/), software_saas (/GOOGLE/) and
  // directors_ammar (/AMMAR BIN SHAHRIN/), which would otherwise grab them.
  { name: "marketing_ads_claim",      match: /\bGOOGLE\s*ADS\b|\bADS?\s*CLAIMS?\b|\bCLAIMS?\s*ADS?\b/i, direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  { name: "purpose_stat_pay",         match: /\b(STAT\s*PAY|STATUTORY)\b/i,           direction: "DR", category: "STATUTORY_PAYMENT" as CashCategory },
  { name: "purpose_inventory",        match: /\bINVENTORY\b/i,                        direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "purpose_digital_ads",      match: /\bDIGITAL\s*ADS?\b/i,                   direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  // NOTE: deliberately NO generic /\bMARKETING\b/ rule. Vendors named "PXL
  // Marketing", "BEST Marketing & Distribution", "Shriyo Marketing" are goods
  // SUPPLIERS, not ad spend; a name-sweep mis-booked them as marketing. Real
  // marketing = Google Ads (ads module) + SMS Niaga only (rules below).
  { name: "purpose_rent",             match: /\bRENT(AL)?\b/i,                        direction: "DR", category: "RENT" as CashCategory },
  { name: "purpose_utility",          match: /\bUTILIT(Y|IES)\b/i,                    direction: "DR", category: "UTILITIES" as CashCategory },
  // Internet/ISP is a UTILITY (per owner) and must outrank the generic
  // /SUBSCRIPTION/ software rule ("internet subscription").
  { name: "util_internet",            match: /TIME\s*DOTCOM|TIMEDOTCOM|TT\s*DOTCOM|TTDOTCOM|TIME\s*FIBRE|\bINTERNET\b/i, direction: "DR", category: "UTILITIES" as CashCategory },
  { name: "purpose_software",         match: /\bSOFTWARE|\bSAAS\b|\bSUBSCRIPTION\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },
  { name: "purpose_petty_cash",       match: /\bPETTY\s*CASH\b/i,                     direction: "DR", category: "PETTY_CASH" as CashCategory },
  { name: "purpose_staff_claim",      match: /\bSTAFF\s*CLAIM|\bCLAIM\b/i,             direction: "DR", category: "STAFF_CLAIM" as CashCategory },
  { name: "purpose_maintenance",      match: /\bMAINTENANCE\b|\bREPAIR\b|\bSERVICING\b|\bDEMO\s*AND\s*REINS|\bDEMOLISH\b/i, direction: "DR", category: "MAINTENANCE" as CashCategory },
  // Note: kitchen hood often runs into reference numbers without space
  // ("Kitchen hoodI2601011"), so no trailing word boundary on those.
  { name: "purpose_equipment",        match: /\bEQUIPMENT\b|\bMACHINE\b|\bFREEZER\b|\bKITCHEN\s*HOOD|\bWALL\s*SHELVES?\b|\bWET\s*CHEMICAL\b|\bRACK\b/i, direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "purpose_kol",              match: /\bKOL\b|\bINFLUENCER\b/i,               direction: "DR", category: "KOL" as CashCategory },
  { name: "purpose_renovation",       match: /\bRENOVATION\b|\bRENOVATE\b/i,          direction: "DR", category: "INVESTMENTS" as CashCategory },
  { name: "purpose_legal",            match: /\bLEGAL\s*FEE|\bASHRAF\s*&\s*PARTNERS|\bLAWYER\b/i, direction: "DR", category: "COMPLIANCE" as CashCategory },
  // No trailing boundary: Maybank purpose suffixes run straight into references
  // ("DIVIDENDQ1 2"), which a \b after the word would reject.
  { name: "purpose_dividend",         match: /\bDIVIDEN/i,                            direction: "DR", category: "DIVIDEND" as CashCategory },
  { name: "purpose_cfs_contract",     match: /\bCFS\s*CONTRACT\b|\bCFS\s*FEE\b/i,     direction: "DR", category: "CFS_FEE" as CashCategory },
  { name: "purpose_audit",            match: /\bAUDIT\s*FEE\b|\bAUDIT\b/i,            direction: "DR", category: "COMPLIANCE" as CashCategory },
  { name: "purpose_tax_agent",        match: /\bTAXATION\b|\bTAX\s*(FORM|AGENT|FILING)/i, direction: "DR", category: "TAX" as CashCategory },

  // Facility services — pest control / cleaning / small works contractors.
  { name: "maint_rentokil",   match: /\bRENTOKIL\b/i,      direction: "DR", category: "MAINTENANCE" as CashCategory },
  { name: "maint_cleanhero",  match: /\bCLEANHERO\b/i,     direction: "DR", category: "MAINTENANCE" as CashCategory },
  { name: "maint_simple_axe", match: /\bSIMPLE\s*AXE\b/i,  direction: "DR", category: "MAINTENANCE" as CashCategory },

  // Statutory — EPF / SOCSO / EIS / KWSP / PERKESO / LHDN tax
  { name: "statutory_epf",   match: /\b(EPF|KWSP|M2UBEPF)\b/i,            direction: "DR", category: "STATUTORY_PAYMENT" as CashCategory },
  { name: "statutory_socso", match: /\b(SOCSO|PERKESO|SIP)\b/i,            direction: "DR", category: "STATUTORY_PAYMENT" as CashCategory },
  { name: "tax_lhdn",        match: /\b(LHDN|INLAND REVENUE|HASIL)\b/i,    direction: "DR", category: "TAX" as CashCategory },

  // Rent — known landlords. Add to this list as new outlets onboard.
  { name: "rent_tujuan_gemilang",     match: /\bTUJUAN\s*GEMILANG\b/i,    direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_mayang_development",  match: /\bMAYANG\s*DEVELOPMENT\b/i, direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_azhar_bin_md_suri",   match: /\bAZHAR\s*BIN\s*MD\s*SURI\b/i, direction: "DR", category: "RENT" as CashCategory },
  // Generic property-management hints
  { name: "rent_properties_sdn_bhd",  match: /\bPROPERTIES\s*SDN\s*BHD\b/i, direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_holdings_sdn_bhd",    match: /\bHOLDINGS\s*SDN\s*BHD\b/i,   direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_hartanah",            match: /\bHARTANAH\b/i,               direction: "DR", category: "RENT" as CashCategory },
  { name: "rent_pilihan_megah",       match: /PILIHAN\s*MEGAH/i,            direction: "DR", category: "RENT" as CashCategory },

  // Utilities — TNB / AIR / IWK / TM / MAXIS / DIGI / UNIFI / TIME / TT Dotcom
  { name: "util_tnb",       match: /\bTNB\b|\bTENAGA NASIONAL\b/i, direction: "DR", category: "UTILITIES" as CashCategory },
  { name: "util_water",     match: /\b(AIR\s+(SELANGOR|PUTRAJAYA|JOHOR|MELAKA)|INDAH WATER|IWK)\b|\bWATER\b/i, direction: "DR", category: "UTILITIES" as CashCategory },
  { name: "util_telco",     match: /\b(MAXIS|DIGI|UNIFI|TM\s|CELCOM|U MOBILE)\b/i, direction: "DR", category: "UTILITIES" as CashCategory },

  // Software / SaaS subscriptions
  { name: "software_saas",  match: /\b(GOOGLE|MICROSOFT|ADOBE|FIGMA|NOTION|SLACK|ZOOM|AWS|VERCEL|CLAUDE|ANTHROPIC|OPENAI)\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },
  { name: "software_pos",   match: /\b(STOREHUB|XERO|BUKKU|QUICKBOOKS|HUBSPOT)\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },

  // Loan repayments
  { name: "loan_payment",   match: /\b(LOAN\s*(PAYMENT|PAYBACK|REPAY(MENT)?|SETTLEMENT)|FINANCING|HIRE\s*PURCHASE)\b/i, direction: "DR", category: "LOAN" as CashCategory },
  // ESI standing-instruction auto-debits with a WME reference are the two
  // monthly loan instalments (WME000001 RM2,233 / WME000002 RM2,182, since
  // Jan 2025) — per owner. Match the reference, not the ESI prefix, since the
  // description format varies ("ESI PAYMENT DEBIT …" vs the bare mandate no.).
  { name: "loan_wme_esi",   match: /\bWME\d{4,}\b/i, direction: "DR", category: "LOAN" as CashCategory },

  // Bank fees
  { name: "bank_fee",       match: /\b(SERVICE\s*FEE|HANDLING\s*FEE|BANK\s*CHARGE|MAINTENANCE\s*FEE|GIRO\s*FEE)\b/i, direction: "DR", category: "BANK_FEE" as CashCategory },
  // "DR/CARD SALES" on the DEBIT side is the terminal MDR charge the bank
  // nets off each card settlement (the CR twin is the settlement itself,
  // matched by card_terminal above). Per the owner: book as a bank charge.
  { name: "bank_fee_card_mdr", match: /\b(?:DR|CR)\/?CARD\s*SALES?\b/i, direction: "DR", category: "BANK_FEE" as CashCategory },

  // Marketing — for now ONLY Google Ads + SMS Niaga (per owner). Google Ads is
  // also pulled from the ads module, so DIGITAL_ADS is DEDUPED out of the bank
  // P&L; SMS Niaga is real bank-only spend → OTHER_MARKETING (counted, kept).
  { name: "marketing_digital_ads_meta",  match: /\b(META PLATFORMS|FACEBOOK|INSTAGRAM)\b/i, direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  { name: "marketing_digital_ads_google",match: /\bGOOGLE\s*ADS\b/i,            direction: "DR", category: "DIGITAL_ADS" as CashCategory },
  { name: "marketing_sms_niaga",         match: /\bSMS\s*NIAGA\b|\bSMSNIAGA\b/i, direction: "DR", category: "OTHER_MARKETING" as CashCategory },

  // Marketplace fees — GrabFood / FP commissions
  { name: "marketplace_grab_fee",        match: /\bGRABFOOD\s*COMMISSION\b/i, direction: "DR", category: "MARKETPLACE_FEE" as CashCategory },

  // Partimer payouts — descriptions usually contain "PT Week" or "Partimer"
  { name: "partimer",       match: /\bPT\s*WEEK\b|\bPARTIMER\b/i, direction: "DR", category: "PARTIMER" as CashCategory },

  // Employee Salary — descriptions like "Salary Nov", "SCC_11/25", direct salary transfers
  { name: "salary_explicit",match: /\bSALARY\b/i,                  direction: "DR", category: "EMPLOYEE_SALARY" as CashCategory },
  { name: "salary_scc",     match: /\bSCC[_ ]\d+\/\d+\b/i,         direction: "DR", category: "EMPLOYEE_SALARY" as CashCategory },

  // Director account — ONLY a genuine drawing / amount-due-to-director is a
  // distribution (excluded from P&L). Do NOT blanket-match the name: most
  // "Ammar Bin Shahrin" transfers are REIMBURSEMENTS for company costs he
  // fronted (equipment, supplies, supplier invoices, software, ads) and must
  // NOT be booked as a director allowance. Those fall through to the vendor /
  // purpose rules (Google Ads already handled by marketing_ads_claim; vendor
  // rules below) or to OTHER_OUTFLOW (review + AP-match).
  { name: "director_due",   match: /\bADTD\b|\bDUE\s*(2|TO)?\s*DIRECTO|\bDIRECTOR'?S?\s*(ALLOWANCE|DRAWINGS?)|\bDRAWINGS?\b/i, direction: "DR", category: "DIRECTORS_ALLOWANCE" as CashCategory },

  // Raw Materials — known F&B suppliers (extend as new vendors onboard)
  { name: "raw_aryzta",      match: /\bARYZTA\b/i,                 direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_erul",        match: /\bERUL\s*FOOD\b/i,            direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_sri_ternak",  match: /\bSRI\s*TERNAK\b/i,           direction: "DR", category: "RAW_MATERIALS" as CashCategory },

  // Fixtures / equipment / smallware vendors often fronted by the director
  { name: "equip_ikea",      match: /\bIKEA\b/i,                   direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "equip_mrdiy",     match: /\bMR\s*DIY\b|\bMRDIY\b/i,     direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "equip_cookerland",match: /\bCOOKERLAND\b/i,             direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "equip_decasa",    match: /\bDECASA\b/i,                 direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "software_gsuite", match: /\bG\s*SUITE\b|\bGSUITE\b|\bGOOGLE\s*WORKSPACE\b/i, direction: "DR", category: "SOFTWARE" as CashCategory },
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

  // Additional named F&B / coffee / packaging suppliers (recurring vendors
  // previously falling into OTHER_OUTFLOW; extend as new vendors appear).
  { name: "raw_country_bread",  match: /\bCOUNTRY\s*BREAD\b/i,       direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_beard_brothers", match: /\bBEARD\s*BROTHERS\b/i,      direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_sri_ternak",     match: /\bSRI\s*TERNAK\b/i,          direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_rich_products",  match: /\bRICH\s*PRODUCTS\b/i,       direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_jg_pacific",     match: /\bJG\s*PACIFIC\b/i,          direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_eighty_eight",   match: /\bEIGHTY\s*EIGHT\s*FAHREN/i, direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_mikofee",        match: /\bMIKOFEE\b/i,               direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_unique_paper",   match: /\bUNIQUE\s*PAPER\b/i,        direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_jijus_cakes",    match: /JIJUS?\s*CAKES/i,            direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_bgs_trading",    match: /\bBGS\s*TRADING/i,           direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_milk_ministry",  match: /MILK\s*MINISTRY/i,           direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_elite_pac",      match: /ELITE\s*PAC\b/i,             direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  { name: "raw_kl_fried",       match: /KUALA\s*LUMPUR\s*FRIED/i,    direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  // Ariff Izham fronts the ad-hoc purchases — his reimbursements are goods
  // buys (per owner). Claims/salary keywords above still win when present.
  { name: "raw_ariff_adhoc",    match: /ARIFF\s*IZHAM/i,             direction: "DR", category: "RAW_MATERIALS" as CashCategory },
  // Marketing vendors (per owner)
  { name: "mkt_web_impian",     match: /WEB\s*IMPIAN/i,              direction: "DR", category: "OTHER_MARKETING" as CashCategory },
  { name: "mkt_asia_square",    match: /ASIA\s*SQUARE/i,             direction: "DR", category: "OTHER_MARKETING" as CashCategory },

  // Staff weekly payroll — "SCC Week NN" transfers to named employees.
  { name: "salary_scc_week",    match: /\bSCC\s*WE/i,                direction: "DR", category: "EMPLOYEE_SALARY" as CashCategory },

  // Capex — fit-out / furniture / signage (excluded from operating P&L).
  { name: "capex_bespoke_interior", match: /\bBESPOKE\s*INTERIOR\b/i, direction: "DR", category: "INVESTMENTS" as CashCategory },
  { name: "capex_kian_contract",    match: /\bKIAN\s*CONTRACT\b/i,    direction: "DR", category: "EQUIPMENTS" as CashCategory },
  { name: "capex_wison_signboard",  match: /\bWISON\s*SIGNBOARD\b/i,  direction: "DR", category: "EQUIPMENTS" as CashCategory },

  // Generic SDN BHD vendor (lowest priority — fires only after the named
  // vendor list above has missed). Marked OTHER_OUTFLOW so finance can
  // re-classify; safer than guessing RAW_MATERIALS.
  { name: "vendor_sdn_bhd",  match: /\bSDN\.?\s*BHD\b/i,           direction: "DR", category: "OTHER_OUTFLOW" as CashCategory },

  // InterCo fallback — runs LAST, only fires when no purpose suffix
  // matched above. Picks up generic "TRANSFER FR A/C CELSIUS COFFEE
  // SDN/CONE/TAMA" lines where the counterparty is another Celsius
  // entity but no Stat-pay / Inventory / Mngmt-fee / Salary suffix
  // exists. These are bona-fide internal transfers and net to zero
  // across consolidation, so flagging isInterCo=true keeps them out
  // of cash-burn totals.
  { name: "interco_celsius_entity_fallback", match: /TRANSFER (TO|FR) A\/C CELSIUS\s?COFFEE\s+(SDN|CONEZION|TAMARIND|CONE|TAMA)/i, direction: "DR", category: "INTERCO_PEOPLE" as CashCategory, isInterCo: true },
];

// InterCo override: any transfer whose COUNTERPARTY (the name right after
// "TRANSFER TO/FR A/C") is another Celsius entity is internal movement within
// the group — flag it InterCo regardless of the stated purpose. (Per the owner:
// "anything transferred in and out within the Celsius Coffee company.") We still
// keep the purpose-based category so the P&L can attribute the real spend, but
// the flag lets the ledger exclude internal shuffling. Matched on the
// counterparty position only, so a supplier payment that merely references
// "Celsius Coffee" elsewhere in the line is NOT caught.
const INTERCO_COUNTERPARTY = /TRANSFER (TO|FR) A\/C CELSIUS ?COFFEE (SDN|CONEZION|TAMARIND|CONE|TAMA)/;

export function classifyBankLine(input: ClassifyInput): ClassifyResult {
  const desc = input.description ?? "";
  const norm = desc.toUpperCase().replace(/\s+/g, " ").trim();
  const intercoCounterparty = INTERCO_COUNTERPARTY.test(norm);

  // Maybank's beneficiary field glues a fixed-width 20-char sender name straight
  // onto the payee — "CELSIUS COFFEE PUTRAYOW SENG SDN BHD*…" — which defeats
  // every \b-anchored rule ("PUTRAYOW" is one word). When the description starts
  // with the sender prefix, also match against the string with those 20 chars
  // stripped, so the payee is rule-visible. Rule priority still wins: each rule
  // is tried on both variants before moving to the next rule.
  const candidates = [norm];
  const rawUpper = desc.toUpperCase().trimStart();
  if (/^CELSIUS\s?COFFEE/.test(rawUpper) && rawUpper.length > 20) {
    const stripped = rawUpper.slice(20).replace(/\s+/g, " ").trim();
    if (stripped) candidates.push(stripped);
  }

  const rules = input.direction === "CR" ? INFLOW_RULES : OUTFLOW_RULES;
  for (const rule of rules) {
    if (rule.direction && rule.direction !== input.direction) continue;
    if (candidates.some((c) => rule.match.test(c))) {
      return {
        category: rule.category,
        outletCode: inferOutlet(desc),
        isInterCo: (rule.isInterCo ?? false) || intercoCounterparty,
        ruleName: rule.name,
      };
    }
  }

  // Supplier registry: an outflow whose payee is a known procurement supplier
  // is a goods purchase even when no hardcoded rule names them.
  if (input.direction === "DR" && input.vendorHints?.length) {
    for (const hint of input.vendorHints) {
      if (candidates.some((c) => c.includes(hint))) {
        return {
          category: "RAW_MATERIALS" as CashCategory,
          outletCode: inferOutlet(desc),
          isInterCo: intercoCounterparty,
          ruleName: "vendor_registry",
        };
      }
    }
  }

  return {
    category: input.direction === "CR" ? ("OTHER_INFLOW" as CashCategory) : ("OTHER_OUTFLOW" as CashCategory),
    outletCode: inferOutlet(desc),
    isInterCo: intercoCounterparty,
    ruleName: "fallback_other",
  };
}
