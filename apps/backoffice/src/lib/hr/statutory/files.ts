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
  wage: number;                 // basis for statutory (basic + contributing allowances)
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
};

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
  let totals = { socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0 };
  for (const e of employees) {
    if (e.socsoEmployee + e.socsoEmployer + e.eisEmployee + e.eisEmployer === 0) continue;
    rows.push([
      String(i++),
      `"${(e.icNumber || "").replace(/-/g, "")}"`,
      `"${sanitize(e.fullName || e.name)}"`,
      `"${e.socsoNumber || ""}"`,
      e.wage.toFixed(2),
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
