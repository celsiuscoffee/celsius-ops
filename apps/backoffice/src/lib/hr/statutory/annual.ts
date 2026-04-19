// Annual LHDN forms: EA (per employee), Form E + CP8D (employer)

export type EARecord = {
  userId: string;
  name: string;
  fullName: string | null;
  icNumber: string | null;
  taxNumber: string | null;
  epfNumber: string | null;
  socsoNumber: string | null;
  commencementDate: string | null;
  ceasedDate: string | null;
  cp8dStatus: string | null;          // Permanent / Contract / Trainee / Other
  // YTD totals from payroll runs
  grossRemuneration: number;          // B.1(a) - basic + OT + paid leave + arrears
  feesCommissions: number;            // B.1(b) - director fee + bonus + commission + profit sharing
  otherAllowances: number;            // B.1(c) - taxable fixed allowances + perquisites
  esopBenefit: number;                // B.1(e)
  bikValue: number;                   // B.3
  livingAccommodation: number;        // B.4
  epfEmployee: number;                // D.4 (a)
  socsoEmployee: number;              // D.4 (b)
  pcbTax: number;                     // D.1
  cp38Deduction: number;              // D.2
  zakat: number;                      // D.3
};

export type EAFormData = EARecord & {
  company: { name: string; ssm: string | null; employerNo: string | null };
  year: number;
};

// EA form CSV — one row per employee, easy to import into Excel or print as PDF template
export function generateEAFormCSV(
  year: number,
  employees: EARecord[],
  company: { name: string; ssm: string | null; employerNo: string | null },
): { content: string; filename: string; mime: string; summary: { count: number } } {
  const header = [
    "Employee Name","IC","Tax No","EPF No","SOCSO No","Position Status",
    "B.1(a) Gross","B.1(b) Fees & Commissions","B.1(c) Allowances","B.1(e) ESOS","B.3 BIK","B.4 Living Accommodation",
    "D.1 PCB","D.2 CP38","D.3 Zakat","D.4(a) EPF Employee","D.4(b) SOCSO Employee",
    "Commencement","Ceased",
  ];
  const rows: string[] = [header.map(csv).join(",")];
  for (const e of employees) {
    rows.push([
      csv(e.fullName || e.name),
      csv(e.icNumber),
      csv(e.taxNumber),
      csv(e.epfNumber),
      csv(e.socsoNumber),
      csv(e.cp8dStatus),
      e.grossRemuneration.toFixed(2),
      e.feesCommissions.toFixed(2),
      e.otherAllowances.toFixed(2),
      e.esopBenefit.toFixed(2),
      e.bikValue.toFixed(2),
      e.livingAccommodation.toFixed(2),
      e.pcbTax.toFixed(2),
      e.cp38Deduction.toFixed(2),
      e.zakat.toFixed(2),
      e.epfEmployee.toFixed(2),
      e.socsoEmployee.toFixed(2),
      csv(e.commencementDate),
      csv(e.ceasedDate),
    ].join(","));
  }
  return {
    content: rows.join("\r\n") + "\r\n",
    filename: `EA_FORM_${year}_${csv(company.name).replace(/\s/g, "_")}.csv`,
    mime: "text/csv",
    summary: { count: employees.length },
  };
}

// Form E (employer annual return) header + CP8D (employee listing)
// LHDN accepts a CSV upload at e-Data Praisi / HASiL portal for CP8D.
export function generateFormE_CP8D(
  year: number,
  employees: EARecord[],
  company: { name: string; ssm: string | null; employerNo: string | null },
): { formE: { content: string; filename: string; mime: string };
     cp8d: { content: string; filename: string; mime: string };
     summary: Record<string, number> } {

  // CP8D CSV — LHDN e-Data format. Columns per LHDN spec (simplified):
  // No | Name | IC New | IC Old | Passport | Tax No | Category | Position Status |
  // Gross | BIK | EPF | SOCSO | Zakat | PCB | CP38 | EA Cert | Date Joined | Date Left
  const cp8dRows: string[] = [];
  cp8dRows.push([
    "No","Name","IC","ICOld","Passport","TaxNo","Category","Status",
    "GrossIncome","BIK","EPFEmployee","SOCSOEmployee","Zakat","PCB","CP38",
    "EAIssued","DateJoined","DateLeft",
  ].map(csv).join(","));

  let i = 1;
  const totals = {
    gross: 0, bik: 0, epf: 0, socso: 0, zakat: 0, pcb: 0, cp38: 0,
  };
  for (const e of employees) {
    const totalGross = e.grossRemuneration + e.feesCommissions + e.otherAllowances + e.esopBenefit;
    cp8dRows.push([
      String(i++),
      csv(e.fullName || e.name),
      csv((e.icNumber || "").replace(/-/g, "")),
      "",
      "",
      csv(e.taxNumber),
      "1",   // Category 1 = employee
      csv(e.cp8dStatus || "Permanent"),
      totalGross.toFixed(2),
      (e.bikValue + e.livingAccommodation).toFixed(2),
      e.epfEmployee.toFixed(2),
      e.socsoEmployee.toFixed(2),
      e.zakat.toFixed(2),
      e.pcbTax.toFixed(2),
      e.cp38Deduction.toFixed(2),
      "Y",
      csv(e.commencementDate),
      csv(e.ceasedDate),
    ].join(","));
    totals.gross += totalGross;
    totals.bik += e.bikValue + e.livingAccommodation;
    totals.epf += e.epfEmployee;
    totals.socso += e.socsoEmployee;
    totals.zakat += e.zakat;
    totals.pcb += e.pcbTax;
    totals.cp38 += e.cp38Deduction;
  }

  // Form E summary
  const formELines = [
    `Form E - Employer Annual Return ${year}`,
    `Employer Name:,${csv(company.name)}`,
    `SSM:,${csv(company.ssm)}`,
    `Employer Tax E Number:,${csv(company.employerNo)}`,
    `Total Employees:,${employees.length}`,
    ``,
    `A1. No. of employees as at 31 December ${year}:,${employees.length}`,
    `A2. No. of new employees:,${employees.filter((e) => e.commencementDate && new Date(e.commencementDate).getFullYear() === year).length}`,
    `A3. No. of ceased employees:,${employees.filter((e) => e.ceasedDate && new Date(e.ceasedDate).getFullYear() === year).length}`,
    ``,
    `Total Gross Remuneration:,${totals.gross.toFixed(2)}`,
    `Total Benefits in Kind:,${totals.bik.toFixed(2)}`,
    `Total EPF (Employee):,${totals.epf.toFixed(2)}`,
    `Total SOCSO (Employee):,${totals.socso.toFixed(2)}`,
    `Total Zakat:,${totals.zakat.toFixed(2)}`,
    `Total PCB Deducted:,${totals.pcb.toFixed(2)}`,
    `Total CP38 Deducted:,${totals.cp38.toFixed(2)}`,
  ];

  return {
    formE: {
      content: formELines.join("\r\n") + "\r\n",
      filename: `FORM_E_${year}.csv`,
      mime: "text/csv",
    },
    cp8d: {
      content: cp8dRows.join("\r\n") + "\r\n",
      filename: `CP8D_${year}.csv`,
      mime: "text/csv",
    },
    summary: { count: employees.length, ...totals },
  };
}

function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,\r\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
