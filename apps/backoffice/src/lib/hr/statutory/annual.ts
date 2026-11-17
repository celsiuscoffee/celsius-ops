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
  grossRemuneration: number;          // B.1(a) - basic + OT + paid leave + current-year arrears
  feesCommissions: number;            // B.1(b) - director fee + bonus + commission + profit sharing
  otherAllowances: number;            // B.1(c) - taxable fixed allowances + perquisites
  esopBenefit: number;                // B.1(e)
  priorYearArrears: number;           // B.2 - arrears for an earlier year paid in this year
  priorYearArrearsYears: number[];    // B.2 - the year(s) those arrears relate to
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

type AllowanceLine = { amount?: unknown; relates_to_year?: unknown } | null | undefined;

// EA B.2: arrears (or other pay) for an EARLIER year that was paid in the
// form's year. A payroll allowance line is B.2 only when it carries
// relates_to_year < formYear (set via the run page's ad-hoc adjustment form,
// or a backfill). Arrears for an earlier month of the SAME year stay in B.1 —
// LHDN only wants prior-year amounts split out, because the employee declares
// them in the year they relate to. Lines without relates_to_year are never
// guessed into B.2: an "Arrears Of Salary" paid in January is usually, but not
// always, December's pay.
export function priorYearArrears(
  allowances: Record<string, AllowanceLine> | null | undefined,
  formYear: number,
): { amount: number; years: number[] } {
  let amount = 0;
  const years = new Set<number>();
  for (const v of Object.values(allowances || {})) {
    const y = Number(v?.relates_to_year);
    const amt = Number(v?.amount || 0);
    if (!Number.isInteger(y) || y >= formYear || amt <= 0) continue;
    amount += amt;
    years.add(y);
  }
  return { amount: Math.round(amount * 100) / 100, years: [...years].sort() };
}

// EA form CSV — one row per employee, easy to import into Excel or print as PDF template
export function generateEAFormCSV(
  year: number,
  employees: EARecord[],
  company: { name: string; ssm: string | null; employerNo: string | null },
): { content: string; filename: string; mime: string; summary: { count: number } } {
  const header = [
    "Employee Name","IC","Tax No","EPF No","SOCSO No","Position Status",
    "B.1(a) Gross","B.1(b) Fees & Commissions","B.1(c) Allowances","B.1(e) ESOS",
    "B.2 Prior-Year Arrears","B.2 Relates To Year","B.3 BIK","B.4 Living Accommodation",
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
      e.priorYearArrears.toFixed(2),
      csv(e.priorYearArrearsYears.join(" ")),
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
    // B.2 arrears were still paid (and PCB'd) in this year, so they stay in
    // the employer's gross for the year — moving them to B.2 only changes
    // which EA box they sit in, not the CP8D / Form E totals.
    const totalGross = e.grossRemuneration + e.feesCommissions + e.otherAllowances + e.esopBenefit
      + e.priorYearArrears;
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
