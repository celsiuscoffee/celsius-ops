// Statutory submission file generators for Malaysian payroll.
// Each fn takes payroll-run data and returns a Buffer + filename + mime.

export type EmployeeRow = {
  userId: string;
  name: string;
  fullName: string | null;
  icNumber: string | null;
  epfNumber: string | null;
  socsoNumber: string | null;
  eisNumber: string | null;
  taxNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  wage: number;                 // EPF/HRDF wage: the statutory basis the contributions were computed on (basic + allowances + PH/rest-day pay), NOT prorated basic
  socsoWage?: number;           // PERKESO wage = statutory basis + overtime (SOCSO/EIS include OT). Falls back to `wage`.
  epfEmployee: number;
  epfEmployer: number;
  socsoEmployee: number;
  socsoEmployer: number;
  eisEmployee: number;
  eisEmployer: number;
  pcbTax: number;
  zakat?: number;
  netPay: number;
  gross: number;
  // Home outlet (display name) — drives the by-outlet finance export. Null for
  // HQ / unassigned staff.
  outlet?: string | null;
  // Rotating / multi-outlet staff (owner 2026-09-03, Syafiq: "divided based
  // on the shifts work in each outlet"): the shifts worked per outlet in the
  // pay period. When present and non-empty the by-outlet export ALLOCATES the
  // employee's cost across these outlets pro rata by shifts instead of
  // charging the home outlet; the home outlet is ignored.
  outletShares?: Array<{ outlet: string; shifts: number }>;
};

/**
 * Split an amount across shares to the cent so the parts sum EXACTLY to the
 * whole — the rounding remainder lands on the largest share. Pure; pinned by
 * payroll-by-outlet.test.ts.
 */
export function allocateByShares(amount: number, shares: number[]): number[] {
  const total = shares.reduce((s, x) => s + Math.max(0, x), 0);
  if (shares.length === 0 || total <= 0) return shares.map(() => 0);
  const cents = Math.round(amount * 100);
  const parts = shares.map((s) => Math.floor((cents * Math.max(0, s)) / total));
  const remainder = cents - parts.reduce((s, x) => s + x, 0);
  const largest = shares.indexOf(Math.max(...shares));
  parts[largest] += remainder;
  return parts.map((c) => c / 100);
}

export type CompanySettings = {
  companyName: string;
  ssmNumber: string | null;
  lhdnENumber: string | null;
  lhdnCNumber: string | null;
  employerEpfNumber: string | null;
  employerSocsoNumber: string | null;
  employerBankAccount: string | null;
  employerBankAccountHolder: string | null;
  hrdfNumber: string | null;
};

// ─── Maybank M2u Biz Bulk Payment (IBG format) ──────────────────
// Used for paying net salaries via M2u Biz upload.
// Format: first row = header, subsequent rows = transaction records.
// Separator: comma; amount has no comma thousands, 2 decimals.
export function generateMaybankM2uBiz(
  run: { period_month: number; period_year: number; payment_date: string; reference?: string },
  employees: EmployeeRow[],
  company: CompanySettings,
): { content: string; filename: string; mime: string; summary: { count: number; total: number; skipped: number } } {
  const lines: string[] = [];
  // Header row per Maybank M2u Biz IBG batch spec
  // HEADER|PayerName|PayerAccount|PaymentDate|Reference|TotalRecords|TotalAmount
  const paymentDate = run.payment_date.replace(/-/g, "");
  const ref = (run.reference || `PAYROLL${run.period_year}${String(run.period_month).padStart(2, "0")}`).slice(0, 20);

  let total = 0;
  let skipped = 0;
  const records: string[] = [];
  for (const e of employees) {
    if (!e.bankAccountNumber || e.netPay <= 0) {
      skipped++;
      continue;
    }
    // DETAIL|BeneficiaryName|BeneficiaryAccount|BankCode|Amount|ID|Reference|Email
    const bankCode = bankCodeMaybank(e.bankName);
    const name = (e.bankAccountName || e.fullName || e.name).slice(0, 40);
    const acct = e.bankAccountNumber.replace(/\s/g, "");
    records.push([
      "DETAIL",
      sanitize(name),
      acct,
      bankCode,
      e.netPay.toFixed(2),
      e.icNumber || "",
      `SALARY${run.period_year}${String(run.period_month).padStart(2, "0")}`,
      "",
    ].join("|"));
    total += e.netPay;
  }

  lines.push([
    "HEADER",
    sanitize(company.companyName).slice(0, 40),
    company.employerBankAccount || "",
    paymentDate,
    ref,
    String(records.length),
    total.toFixed(2),
  ].join("|"));
  lines.push(...records);

  const content = lines.join("\r\n") + "\r\n";
  return {
    content,
    filename: `MAYBANK_PAYROLL_${run.period_year}${String(run.period_month).padStart(2, "0")}.txt`,
    mime: "text/plain",
    summary: { count: records.length, total, skipped },
  };
}

// ─── Payroll by outlet (finance reconciliation CSV) ─────────────
// HQ pays every salary centrally, then recharges each outlet its own labour
// cost. This file is what finance filters to see what an outlet owes HQ
// (owner 2026-09-03: "similar with part-timer" — the PT bank file carries an
// Outlet column for the same reason). It is NOT a bank upload: the Maybank
// file above is a fixed pipe spec, so the outlet split lives here instead.
//
// One row per employee per outlet, grouped by outlet, with a subtotal row per
// outlet and a grand total. "Total cost" = gross + employer EPF/SOCSO/EIS —
// the true amount the outlet owes, not just the net that hits the bank.
//
// Rotating staff (EmployeeRow.outletShares) are SPLIT across the outlets
// they worked in, pro rata by shifts, to the cent (allocateByShares): Syafiq
// in August 2026 worked 7 Shah Alam / 5 Putrajaya / 3 Tamarind shifts, so
// each outlet is charged 7/15, 5/15, 3/15 of his cost. A "Share" column
// records the basis; the grand total counts each person once.
export function generatePayrollByOutlet(
  run: { period_month: number; period_year: number },
  employees: EmployeeRow[],
): { content: string; filename: string; mime: string; summary: { outlets: number; count: number; total: number } } {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rm = (n: number) => n.toFixed(2);
  const HQ = "HQ / unassigned";

  // Explode each employee into (outlet, portion) lines. A portion is the
  // employee's amounts scaled to that outlet's share of their shifts; an
  // unsplit employee is one portion at 100% on their home outlet.
  type Portion = {
    name: string; share: string;
    wage: number; gross: number; epfEmployee: number; epfEmployer: number; socsoEmployer: number; eisEmployer: number; netPay: number;
  };
  const groups = new Map<string, Portion[]>();
  const push = (outlet: string, p: Portion) => {
    const list = groups.get(outlet);
    if (list) list.push(p); else groups.set(outlet, [p]);
  };
  for (const e of employees) {
    const name = e.fullName || e.name;
    const shares = (e.outletShares || []).filter((s) => s.shifts > 0 && (s.outlet || "").trim());
    if (shares.length === 0) {
      push((e.outlet || "").trim() || HQ, {
        name, share: "",
        wage: e.wage, gross: e.gross, epfEmployee: e.epfEmployee, epfEmployer: e.epfEmployer, socsoEmployer: e.socsoEmployer,
        eisEmployer: e.eisEmployer, netPay: e.netPay,
      });
      continue;
    }
    const totalShifts = shares.reduce((s, x) => s + x.shifts, 0);
    const weights = shares.map((s) => s.shifts);
    const wage = allocateByShares(e.wage, weights);
    const gross = allocateByShares(e.gross, weights);
    const epfEe = allocateByShares(e.epfEmployee, weights);
    const epf = allocateByShares(e.epfEmployer, weights);
    const socso = allocateByShares(e.socsoEmployer, weights);
    const eis = allocateByShares(e.eisEmployer, weights);
    const net = allocateByShares(e.netPay, weights);
    shares.forEach((s, i) => {
      push(s.outlet.trim(), {
        name, share: `${s.shifts}/${totalShifts} shifts`,
        wage: wage[i], gross: gross[i], epfEmployee: epfEe[i], epfEmployer: epf[i], socsoEmployer: socso[i], eisEmployer: eis[i], netPay: net[i],
      });
    });
  }
  const outletNames = [...groups.keys()].sort((a, b) =>
    a === HQ ? 1 : b === HQ ? -1 : a.localeCompare(b),
  );

  const rows: string[] = [
    "Outlet,Employee,Share,Basic,Gross,EPF (employee),EPF (employer),SOCSO (employer),EIS (employer),Employer contributions,Total cost,Net pay",
  ];
  let grand = { gross: 0, epfEmployee: 0, contrib: 0, cost: 0, net: 0 };
  for (const outlet of outletNames) {
    const list = groups.get(outlet)!;
    list.sort((a, b) => a.name.localeCompare(b.name));
    const sub = { gross: 0, epfEmployee: 0, contrib: 0, cost: 0, net: 0 };
    for (const p of list) {
      const contrib = Math.round((p.epfEmployer + p.socsoEmployer + p.eisEmployer) * 100) / 100;
      const cost = Math.round((p.gross + contrib) * 100) / 100;
      rows.push([
        esc(outlet), esc(p.name), esc(p.share), rm(p.wage), rm(p.gross),
        rm(p.epfEmployee), rm(p.epfEmployer), rm(p.socsoEmployer), rm(p.eisEmployer),
        rm(contrib), rm(cost), rm(p.netPay),
      ].join(","));
      sub.gross += p.gross; sub.epfEmployee += p.epfEmployee; sub.contrib += contrib; sub.cost += cost; sub.net += p.netPay;
    }
    rows.push([
      esc(outlet), esc(`SUBTOTAL — ${outlet} (${list.length} line${list.length === 1 ? "" : "s"})`), "", "", rm(sub.gross),
      rm(sub.epfEmployee), "", "", "", rm(sub.contrib), rm(sub.cost), rm(sub.net),
    ].join(","));
    grand = {
      gross: grand.gross + sub.gross, epfEmployee: grand.epfEmployee + sub.epfEmployee,
      contrib: grand.contrib + sub.contrib, cost: grand.cost + sub.cost, net: grand.net + sub.net,
    };
  }
  rows.push([
    "", esc(`TOTAL (${employees.length} staff)`), "", "", rm(grand.gross),
    rm(grand.epfEmployee), "", "", "", rm(grand.contrib), rm(grand.cost), rm(grand.net),
  ].join(","));

  const ym = `${run.period_year}${String(run.period_month).padStart(2, "0")}`;
  return {
    content: rows.join("\n") + "\n",
    filename: `PAYROLL_BY_OUTLET_${ym}.csv`,
    mime: "text/csv",
    summary: { outlets: outletNames.length, count: employees.length, total: Math.round(grand.cost * 100) / 100 },
  };
}

// ─── KWSP (EPF) Form A e-Caruman CSV ────────────────────────────
// Used for monthly EPF contribution submission at https://i-akaun.kwsp.gov.my
// Format: KWSP e-Caruman CSV (one employee per row, no header).
// Columns: EPF_No,IC_No,Name,Wage,EmployeeContribution,EmployerContribution
export function generateKwspFormA(
  run: { period_month: number; period_year: number },
  employees: EmployeeRow[],
  company: CompanySettings,
): { content: string; filename: string; mime: string; summary: Record<string, number> } {
  const rows: string[] = [];
  // KWSP e-Caruman format (as per KWSP template):
  // Employer number header row, then employee rows
  rows.push(`"${company.employerEpfNumber || ""}","${run.period_year}","${String(run.period_month).padStart(2, "0")}"`);

  let totalEmployee = 0;
  let totalEmployer = 0;
  let count = 0;

  for (const e of employees) {
    if (e.epfEmployee === 0 && e.epfEmployer === 0) continue;
    rows.push([
      `"${e.epfNumber || ""}"`,
      `"${(e.icNumber || "").replace(/-/g, "")}"`,
      `"${sanitize(e.fullName || e.name)}"`,
      e.wage.toFixed(2),
      e.epfEmployee.toFixed(2),
      e.epfEmployer.toFixed(2),
    ].join(","));
    totalEmployee += e.epfEmployee;
    totalEmployer += e.epfEmployer;
    count++;
  }

  return {
    content: rows.join("\r\n") + "\r\n",
    filename: `KWSP_FORMA_${run.period_year}${String(run.period_month).padStart(2, "0")}.csv`,
    mime: "text/csv",
    summary: { count, totalEmployee, totalEmployer, grandTotal: totalEmployee + totalEmployer },
  };
}

// ─── PERKESO Lampiran A (SOCSO + EIS combined) ──────────────────
// Used for Assist Portal monthly submission (combined SOCSO + EIS).
// CSV with header row.
export function generatePerkesoLampiranA(
  run: { period_month: number; period_year: number },
  employees: EmployeeRow[],
  company: CompanySettings,
): { content: string; filename: string; mime: string; summary: Record<string, number> } {
  const rows: string[] = [];
  rows.push([
    "No",
    "IC",
    "Name",
    "SOCSO No",
    "Wage",
    "SOCSO Employee",
    "SOCSO Employer",
    "EIS Employee",
    "EIS Employer",
  ].join(","));

  let i = 1;
  const totals = { socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0 };
  for (const e of employees) {
    if (e.socsoEmployee + e.socsoEmployer + e.eisEmployee + e.eisEmployer === 0) continue;
    rows.push([
      String(i++),
      `"${(e.icNumber || "").replace(/-/g, "")}"`,
      `"${sanitize(e.fullName || e.name)}"`,
      `"${e.socsoNumber || ""}"`,
      (e.socsoWage ?? e.wage).toFixed(2),
      e.socsoEmployee.toFixed(2),
      e.socsoEmployer.toFixed(2),
      e.eisEmployee.toFixed(2),
      e.eisEmployer.toFixed(2),
    ].join(","));
    totals.socsoEe += e.socsoEmployee;
    totals.socsoEr += e.socsoEmployer;
    totals.eisEe += e.eisEmployee;
    totals.eisEr += e.eisEmployer;
  }

  return {
    content: rows.join("\r\n") + "\r\n",
    filename: `PERKESO_LAMPIRAN_A_${run.period_year}${String(run.period_month).padStart(2, "0")}.csv`,
    mime: "text/csv",
    summary: { count: i - 1, ...totals },
  };
}

// ─── LHDN CP39 (PCB monthly) ────────────────────────────────────
// Text file format for PCB e-submission at LHDN e-PCB portal.
// Fixed-width per LHDN spec. We emit the CSV flavour for simplicity;
// e-PCB portal accepts CSV upload for CP39.
export function generateCP39(
  run: { period_month: number; period_year: number },
  employees: EmployeeRow[],
  company: CompanySettings,
): { content: string; filename: string; mime: string; summary: Record<string, number> } {
  const rows: string[] = [];
  // CP39 CSV columns per LHDN e-PCB template:
  // No,Tax No,IC Old,IC New,Name,PCB Amount,CP38 Amount,Employer No
  rows.push([
    "No", "TaxNo", "ICOld", "ICNew", "Name", "PCB", "CP38", "EmployerNo",
  ].join(","));

  let i = 1;
  let total = 0;
  for (const e of employees) {
    if (e.pcbTax <= 0) continue;
    rows.push([
      String(i++),
      `"${e.taxNumber || ""}"`,
      "",
      `"${(e.icNumber || "").replace(/-/g, "")}"`,
      `"${sanitize(e.fullName || e.name)}"`,
      e.pcbTax.toFixed(2),
      "0.00",
      `"${company.lhdnENumber || ""}"`,
    ].join(","));
    total += e.pcbTax;
  }

  return {
    content: rows.join("\r\n") + "\r\n",
    filename: `CP39_${run.period_year}${String(run.period_month).padStart(2, "0")}.csv`,
    mime: "text/csv",
    summary: { count: i - 1, totalPcb: total },
  };
}

// ─── HRDF Levy Submission ───────────────────────────────────────
// CSV upload via e-Tris portal. 1% of employee basic+fixed allowances.
export function generateHRDFLevy(
  run: { period_month: number; period_year: number },
  employees: EmployeeRow[],
  company: CompanySettings,
): { content: string; filename: string; mime: string; summary: Record<string, number> } {
  const rows: string[] = [];
  rows.push(["No", "IC", "Name", "Wage", "Levy"].join(","));

  let i = 1;
  let total = 0;
  for (const e of employees) {
    const levy = Math.round(e.wage * 0.01 * 100) / 100;
    if (levy <= 0) continue;
    rows.push([
      String(i++),
      `"${(e.icNumber || "").replace(/-/g, "")}"`,
      `"${sanitize(e.fullName || e.name)}"`,
      e.wage.toFixed(2),
      levy.toFixed(2),
    ].join(","));
    total += levy;
  }

  return {
    content: rows.join("\r\n") + "\r\n",
    filename: `HRDF_LEVY_${run.period_year}${String(run.period_month).padStart(2, "0")}.csv`,
    mime: "text/csv",
    summary: { count: i - 1, totalLevy: total, hrdfNumber: Number(company.hrdfNumber || 0) },
  };
}

// ─── Helpers ────────────────────────────────────────────────────
function sanitize(s: string): string {
  return s.replace(/[,|"\r\n]/g, " ").trim();
}

function bankCodeMaybank(bankName: string | null): string {
  if (!bankName) return "";
  const map: Record<string, string> = {
    "Maybank": "MBBEMYKL",
    "Malayan Banking Berhad": "MBBEMYKL",
    "CIMB Bank": "CIBBMYKL",
    "Public Bank": "PBBEMYKL",
    "RHB Bank": "RHBBMYKL",
    "Hong Leong Bank": "HLBBMYKL",
    "AmBank": "ARBKMYKL",
    "Bank Islam": "BIMBMYKL",
    "Bank Rakyat": "BKRMMYKL",
    "Bank Muamalat": "BMMBMYKL",
    "BSN": "BSNAMYK1",
    "Agrobank": "AGOBMYKL",
    "Alliance Bank": "MFBBMYKL",
    "Affin Bank": "PHBMMYKL",
    "HSBC Malaysia": "HBMBMYKL",
    "Standard Chartered": "SCBLMYKX",
    "OCBC Bank": "OCBCMYKL",
    "UOB Malaysia": "UOVBMYKL",
    "Citibank Malaysia": "CITIMYKL",
    "MBSB Bank": "AFBQMYKL",
    "GXBank": "GXBKMYKL",
    "Aeon Bank": "AONBMYKL",
  };
  return map[bankName] || "";
}
