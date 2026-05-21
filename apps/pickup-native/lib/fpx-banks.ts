// FPX bank codes accepted by Revenue Monster's Direct Payment Checkout
// Mode: FPX. Source: https://doc.revenuemonster.my/docs/bank-code
// Any code not on this list is rejected by RM; keep this in sync if RM
// publishes additions.
//
// Each entry also carries a presentation color + short monogram for the
// in-app picker. Colors are the banks' publicly-known brand colors;
// monograms are 1–3 letter shorthand chosen so the customer recognises
// the bank at a glance without us reproducing official logo art.
export type FpxBank = {
  code:     string;
  name:     string;
  short:    string;   // monogram used in the icon chip
  bg:       string;   // chip background color
  fg:       string;   // text color over bg
};

export const FPX_BANKS: ReadonlyArray<FpxBank> = [
  { code: "MB2U0227:B2C",  name: "Maybank2U",               short: "M",   bg: "#FFC72C", fg: "#0A0A0A" },
  { code: "MBB0228:B2C",   name: "Maybank2E",               short: "M2E", bg: "#FFC72C", fg: "#0A0A0A" },
  { code: "BCBB0235:B2C",  name: "CIMB Bank",               short: "C",   bg: "#A1132E", fg: "#FFFFFF" },
  { code: "PBB0233:B2C",   name: "Public Bank",             short: "PB",  bg: "#BF2A2C", fg: "#FFFFFF" },
  { code: "RHB0218:B2C",   name: "RHB Bank",                short: "RHB", bg: "#0067B1", fg: "#FFFFFF" },
  { code: "HLB0224:B2C",   name: "Hong Leong Bank",         short: "HL",  bg: "#C8102E", fg: "#FFFFFF" },
  { code: "AMBB0209:B2C",  name: "AmBank",                  short: "A",   bg: "#ED1C24", fg: "#FFFFFF" },
  { code: "BIMB0340:B2C",  name: "Bank Islam",              short: "BI",  bg: "#006A4D", fg: "#FFFFFF" },
  { code: "BKRM0602:B2C",  name: "Bank Rakyat",             short: "BR",  bg: "#0A6E3D", fg: "#FFFFFF" },
  { code: "BMMB0341:B2C",  name: "Bank Muamalat",           short: "BM",  bg: "#C9A227", fg: "#0A0A0A" },
  { code: "BSN0601:B2C",   name: "Bank Simpanan Nasional",  short: "BSN", bg: "#003B7A", fg: "#FFFFFF" },
  { code: "ABB0233:B2C",   name: "Affin Bank",              short: "AF",  bg: "#E87722", fg: "#FFFFFF" },
  { code: "ABMB0212:B2C",  name: "Alliance Bank",           short: "AL",  bg: "#0B2A5B", fg: "#FFFFFF" },
  { code: "AGRO01:B2C",    name: "AGRONet",                 short: "AG",  bg: "#5B8C2A", fg: "#FFFFFF" },
  { code: "HSBC0223:B2C",  name: "HSBC",                    short: "H",   bg: "#DB0011", fg: "#FFFFFF" },
  { code: "KFH0346:B2C",   name: "Kuwait Finance House",    short: "KFH", bg: "#0B6E6E", fg: "#FFFFFF" },
  { code: "OCBC0229:B2C",  name: "OCBC",                    short: "O",   bg: "#D52B1E", fg: "#FFFFFF" },
  { code: "SCB0216:B2C",   name: "Standard Chartered",      short: "SC",  bg: "#0064A8", fg: "#FFFFFF" },
  { code: "UOB0226:B2C",   name: "United Overseas Bank",    short: "UOB", bg: "#005691", fg: "#FFFFFF" },
];
