// Payslip PDF generator + data assembly — SHARED by the backoffice admin
// download and the staff self-service download, so both surfaces render a
// byte-identical, loan-grade payslip. Node-only (fs/pdf-lib): import via the
// subpath `@celsius/shared/src/hr/payslip` from server routes, never the barrel.
//
// Uses pdf-lib (a dependency of this package) for zero-dep rendering, and reads
// the logo from `<cwd>/public/images/celsius-logo-sm.jpg` — present in every
// app that ships a payslip, so process.cwd() resolves it in each one.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

// Logo bytes loaded lazily — file read once per process.
let _logoBytes: Uint8Array | null | undefined;
function loadLogoBytes(): Uint8Array | null {
  if (_logoBytes !== undefined) return _logoBytes;
  try {
    _logoBytes = readFileSync(join(process.cwd(), "public/images/celsius-logo-sm.jpg"));
  } catch {
    _logoBytes = null;
  }
  return _logoBytes;
}

export type PayslipData = {
  // Employee
  employeeName: string;
  employeeFullName: string | null;
  icNumber: string | null;
  position: string | null;
  outlet: string | null;
  epfNumber: string | null;
  socsoNumber: string | null;
  taxNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  // Period
  periodMonth: number;
  periodYear: number;
  paymentDate: string | null;
  // Full pay-period range (ISO date strings) — rendered as an explicit
  // "1 Jun 2026 – 30 Jun 2026" line, which banks/HR expect on a loan payslip.
  periodStart?: string | null;
  periodEnd?: string | null;
  // Earnings
  basicSalary: number;
  regularHours?: number;
  otHours: number;
  ot1xAmount: number;
  ot1_5xAmount: number;
  ot2xAmount: number;
  ot3xAmount: number;
  allowances: { label: string; amount: number }[];
  // Catch-all for earnings not itemized into OT or allowances — e.g.
  // BrioHR-imported rows store a single `gross_additions` value.
  // Rendered as "Additions" in the earnings section.
  otherEarnings: { label: string; amount: number }[];
  gross: number;
  // Deductions
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  pcbTax: number;
  zakat: number;
  unpaidLeave: number;
  reviewPenalty: number;
  otherDeductions: { label: string; amount: number }[];
  totalDeductions: number;
  // Net
  netPay: number;
  // Employer contributions (shown as info)
  epfEmployer: number;
  socsoEmployer: number;
  eisEmployer: number;
  // YTD (Jan 1 → this period, inclusive of BrioHR-imported months)
  ytdGross?: number;
  ytdEpf?: number;
  ytdSocso?: number;
  ytdEis?: number;
  ytdPcb?: number;
  ytdNet?: number;
  // Company
  companyName: string;
  companySSM: string | null;
  // SSM registration number (the "(1424785-A)" form) — shown alongside the
  // newer 12-digit SSM number so the payslip carries the full legal identity.
  companyRegNo?: string | null;
  companyAddress: string | null;
  companyLhdnE: string | null;
  // Employer statutory account numbers — a loan officer verifies the employer
  // against these, so they belong on a payslip used for financing.
  employerEpfNumber?: string | null;
  employerSocsoNumber?: string | null;
  // Disclaimer
  disclaimer?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function embedLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  const bytes = loadLogoBytes();
  if (!bytes) return null;
  try {
    return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function generatePayslipPDF(data: PayslipData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 in points
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);

  drawPayslip(page, font, bold, data, logo);
  return pdf.save();
}

// Multi-employee bundle into a single PDF
export async function generatePayslipBundlePDF(records: PayslipData[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);
  for (const data of records) {
    const page = pdf.addPage([595.28, 841.89]);
    drawPayslip(page, font, bold, data, logo);
  }
  return pdf.save();
}

function drawPayslip(page: PDFPage, font: PDFFont, bold: PDFFont, d: PayslipData, logo: PDFImage | null) {
  const W = 595.28;
  const H = 841.89;
  const M = 36; // margin
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  // Celsius brand — terracotta #C2452D (matches globals.css --color-terracotta)
  const terracotta = rgb(0xC2 / 255, 0x45 / 255, 0x2D / 255);
  const terracottaDark = rgb(0xA3 / 255, 0x38 / 255, 0x22 / 255);

  // Top brand bar (3pt terracotta strip across the whole width)
  page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: terracotta });

  let y = H - M;

  // Header — logo on the left, company info next to it
  const LOGO_SIZE = 44;
  const textX = logo ? M + LOGO_SIZE + 12 : M;
  if (logo) {
    page.drawImage(logo, { x: M, y: y - LOGO_SIZE + 10, width: LOGO_SIZE, height: LOGO_SIZE });
  }

  page.drawText(d.companyName, { x: textX, y, size: 14, font: bold, color: terracotta });
  y -= 13;
  if (d.companySSM || d.companyRegNo) {
    // "SSM: 202101024485 (1424785-A)" — both the 12-digit registration and the
    // legacy company number, matching how the entity is written on official docs.
    const ssmLine = d.companySSM
      ? `SSM: ${d.companySSM}${d.companyRegNo ? ` (${d.companyRegNo})` : ""}`
      : `SSM: ${d.companyRegNo}`;
    page.drawText(ssmLine, { x: textX, y, size: 8, font, color: gray });
    y -= 10;
  }
  if (d.companyAddress) {
    page.drawText(d.companyAddress, { x: textX, y, size: 8, font, color: gray });
    y -= 10;
  }
  {
    // Employer statutory account numbers on one compact line (Tax E · EPF · SOCSO).
    const idParts: string[] = [];
    if (d.companyLhdnE) idParts.push(`Tax E: ${d.companyLhdnE}`);
    if (d.employerEpfNumber) idParts.push(`EPF: ${d.employerEpfNumber}`);
    if (d.employerSocsoNumber) idParts.push(`SOCSO: ${d.employerSocsoNumber}`);
    if (idParts.length > 0) {
      page.drawText(`Employer ${idParts.join("  •  ")}`, { x: textX, y, size: 8, font, color: gray });
      y -= 10;
    }
  }

  // Align y past the logo if logo is taller than text
  if (logo) {
    const logoBottomY = H - M - LOGO_SIZE + 10;
    if (y > logoBottomY) y = logoBottomY;
  }

  // Title banner — filled terracotta bar
  y -= 8;
  const BANNER_H = 22;
  page.drawRectangle({ x: M, y: y - BANNER_H, width: W - 2 * M, height: BANNER_H, color: terracottaDark });
  page.drawText("PAYSLIP", { x: M + 10, y: y - 15, size: 13, font: bold, color: rgb(1, 1, 1) });
  const periodLabel = `${MONTHS[d.periodMonth - 1]} ${d.periodYear}`;
  const periodW = bold.widthOfTextAtSize(periodLabel, 11);
  page.drawText(periodLabel, { x: W - M - periodW - 10, y: y - 14, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= BANNER_H + 14;

  // Employee details (2-col)
  const col1X = M;
  const col2X = W / 2 + 10;
  const rows = [
    ["Name", d.employeeFullName || d.employeeName, "IC", d.icNumber || "—"],
    ["Position", d.position || "—", "EPF No.", d.epfNumber || "—"],
    ["Outlet", d.outlet || "—", "SOCSO No.", d.socsoNumber || "—"],
    ["Tax No.", d.taxNumber || "—", "Bank", d.bankName ? `${d.bankName} • ${maskAccount(d.bankAccountNumber)}` : "—"],
    ["Pay Period", fmtPeriodRange(d), "Payment Date", d.paymentDate || "—"],
  ];
  for (const [l1, v1, l2, v2] of rows) {
    page.drawText(l1, { x: col1X, y, size: 8, font, color: gray });
    page.drawText(String(v1), { x: col1X + 60, y, size: 9, font: bold, color: black });
    if (l2) {
      page.drawText(l2, { x: col2X, y, size: 8, font, color: gray });
      page.drawText(String(v2), { x: col2X + 60, y, size: 9, font: bold, color: black });
    }
    y -= 13;
  }

  // Hours summary — single readable line. Skipped if both fields are zero
  // (intern / contract / no attendance data).
  const reg = Number(d.regularHours || 0);
  const ot = Number(d.otHours || 0);
  if (reg > 0 || ot > 0) {
    y -= 4;
    page.drawText("Hours Worked", { x: col1X, y, size: 8, font, color: gray });
    const hoursLine = reg > 0 && ot > 0
      ? `${reg.toFixed(1)} hrs regular + ${ot.toFixed(1)} hrs OT`
      : reg > 0
        ? `${reg.toFixed(1)} hrs regular`
        : `${ot.toFixed(1)} hrs OT`;
    page.drawText(hoursLine, { x: col1X + 60, y, size: 9, font: bold, color: black });
    y -= 13;
  }

  y -= 8;

  // Earnings / Deductions table (2 columns side-by-side)
  const colW = (W - 2 * M - 10) / 2;
  const leftX = M;
  const rightX = M + colW + 10;

  // Earnings header
  page.drawRectangle({ x: leftX, y: y - 16, width: colW, height: 16, color: rgb(0.96, 0.92, 0.88) });
  page.drawText("EARNINGS", { x: leftX + 6, y: y - 12, size: 9, font: bold, color: terracotta });
  // Deductions header
  page.drawRectangle({ x: rightX, y: y - 16, width: colW, height: 16, color: rgb(0.96, 0.92, 0.88) });
  page.drawText("DEDUCTIONS", { x: rightX + 6, y: y - 12, size: 9, font: bold, color: terracotta });
  y -= 22;

  // Earnings rows
  const earnings: [string, number][] = [
    ["Basic Salary", d.basicSalary],
  ];
  if (d.otHours > 0) {
    // OT hours total is shown in the Hours Worked line above; here we just
    // surface the per-rate breakdown so the math is auditable.
    if (d.ot1xAmount > 0) earnings.push(["OT (1.0× rate)", d.ot1xAmount]);
    if (d.ot1_5xAmount > 0) earnings.push(["OT (1.5× rate)", d.ot1_5xAmount]);
    if (d.ot2xAmount > 0) earnings.push(["OT (2.0× rest day / public holiday)", d.ot2xAmount]);
    if (d.ot3xAmount > 0) earnings.push(["OT (3.0× public holiday)", d.ot3xAmount]);
  }
  for (const a of d.allowances) {
    if (a.amount > 0) earnings.push([a.label, a.amount]);
  }
  // Other earnings (catch-all — imported additions, etc.)
  for (const oe of d.otherEarnings || []) {
    if (oe.amount > 0) earnings.push([oe.label, oe.amount]);
  }
  // Gap-reconciliation safety net — if gross is still higher than the sum
  // of explicitly-rendered earnings (e.g. historical data predating the
  // other_earnings field), show the remainder as 'Other Earnings' so the
  // column always sums to gross.
  const itemizedEarnings = earnings.reduce((s, [, n]) => s + n, 0);
  const earningsGap = Math.round((d.gross - itemizedEarnings) * 100) / 100;
  if (earningsGap > 0.05) {
    earnings.push(["Other Earnings", earningsGap]);
  }

  // Deductions rows
  const deductions: [string, number][] = [];
  if (d.epfEmployee > 0) deductions.push(["EPF (employee)", d.epfEmployee]);
  if (d.socsoEmployee > 0) deductions.push(["SOCSO (employee)", d.socsoEmployee]);
  if (d.eisEmployee > 0) deductions.push(["EIS (employee)", d.eisEmployee]);
  if (d.pcbTax > 0) deductions.push(["PCB (income tax)", d.pcbTax]);
  if (d.zakat > 0) deductions.push(["Zakat", d.zakat]);
  if (d.unpaidLeave > 0) deductions.push(["Unpaid Leave", d.unpaidLeave]);
  if (d.reviewPenalty > 0) deductions.push(["Review Penalty", d.reviewPenalty]);
  for (const od of d.otherDeductions) {
    if (od.amount > 0) deductions.push([od.label, od.amount]);
  }

  // Render rows side-by-side
  let leftY = y;
  let rightY = y;
  const rowH = 13;
  for (const [label, amt] of earnings) {
    drawRow(page, font, bold, leftX + 6, leftY, colW - 12, label, amt, black);
    leftY -= rowH;
  }
  for (const [label, amt] of deductions) {
    drawRow(page, font, bold, rightX + 6, rightY, colW - 12, label, amt, black);
    rightY -= rowH;
  }

  // Bring both columns to same Y (the lower of the two)
  const lineEndY = Math.min(leftY, rightY) - 4;
  page.drawLine({ start: { x: leftX, y: lineEndY }, end: { x: leftX + colW, y: lineEndY }, thickness: 0.5, color: gray });
  page.drawLine({ start: { x: rightX, y: lineEndY }, end: { x: rightX + colW, y: lineEndY }, thickness: 0.5, color: gray });

  // Totals row
  const totalY = lineEndY - 14;
  drawRow(page, font, bold, leftX + 6, totalY, colW - 12, "Gross Pay", d.gross, black, true);
  drawRow(page, font, bold, rightX + 6, totalY, colW - 12, "Total Deductions", d.totalDeductions, black, true);

  y = totalY - 24;

  // Net Pay — slightly taller and bigger amount type so it's the unmistakable
  // anchor of the page when employees scan their payslip.
  const NET_H = 36;
  page.drawRectangle({ x: M, y: y - NET_H, width: W - 2 * M, height: NET_H, color: terracotta });
  page.drawText("NET PAY", { x: M + 14, y: y - 23, size: 13, font: bold, color: rgb(1, 1, 1) });
  const netText = fmtRM(d.netPay);
  const netWidth = bold.widthOfTextAtSize(netText, 19);
  page.drawText(netText, { x: W - M - netWidth - 14, y: y - 25, size: 19, font: bold, color: rgb(1, 1, 1) });
  y -= NET_H + 14;

  // Employer contributions (info only)
  page.drawText("EMPLOYER CONTRIBUTIONS (info — not deducted from your pay)", { x: M, y, size: 8, font: bold, color: gray });
  y -= 12;
  const employerLines = [
    ["EPF (employer)", d.epfEmployer],
    ["SOCSO (employer)", d.socsoEmployer],
    ["EIS (employer)", d.eisEmployer],
  ];
  for (const [label, amt] of employerLines) {
    drawRow(page, font, bold, M + 6, y, W - 2 * M - 12, String(label), Number(amt), gray);
    y -= 12;
  }

  // YTD summary (if available)
  if (d.ytdGross !== undefined) {
    y -= 10;
    page.drawText(`YEAR-TO-DATE (Jan ${d.periodYear} - ${MONTHS[d.periodMonth - 1]})`, { x: M, y, size: 8, font: bold, color: gray });
    y -= 12;
    const ytdLines: [string, number][] = [
      ["Net Pay YTD", d.ytdNet ?? 0],
      ["Gross YTD", d.ytdGross ?? 0],
      ["EPF YTD", d.ytdEpf ?? 0],
      ["SOCSO YTD", d.ytdSocso ?? 0],
      ["EIS YTD", d.ytdEis ?? 0],
      ["PCB YTD", d.ytdPcb ?? 0],
    ];
    for (const [label, amt] of ytdLines) {
      drawRow(page, font, bold, M + 6, y, W - 2 * M - 12, label, amt, gray);
      y -= 12;
    }
  }

  // Footer — light divider rule, then a single line with company tagline on
  // the left and the autogenerated payslip ref on the right so it can be
  // referenced in queries / WhatsApp threads.
  const footerY = M + 6;
  page.drawLine({
    start: { x: M, y: footerY + 18 }, end: { x: W - M, y: footerY + 18 },
    thickness: 0.4, color: rgb(0.85, 0.85, 0.85),
  });
  if (d.disclaimer) {
    page.drawText(d.disclaimer, {
      x: M, y: footerY + 24, size: 7, font, color: gray, maxWidth: W - 2 * M,
    });
  }
  page.drawText("This is a computer-generated payslip and does not require a signature.", {
    x: M, y: footerY + 6, size: 7, font, color: gray,
  });
  // Payslip reference: PAY-YYYYMM-FIRSTNAME (Malay names are given-name-first, so
  // the first token is the person's name; the trailing tokens are the father's).
  const firstName = (d.employeeName || d.employeeFullName || "").trim().split(/\s+/)[0] || "";
  const ref = `PAY-${d.periodYear}${String(d.periodMonth).padStart(2, "0")}-${firstName.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const refW = font.widthOfTextAtSize(ref, 7);
  page.drawText(ref, { x: W - M - refW, y: footerY + 6, size: 7, font, color: gray });
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  width: number,
  label: string,
  amount: number,
  color: ReturnType<typeof rgb>,
  isBold = false,
) {
  const labelFont = isBold ? bold : font;
  const amtFont = isBold ? bold : font;
  page.drawText(label, { x, y, size: 9, font: labelFont, color });
  const txt = fmtRM(amount);
  const tw = amtFont.widthOfTextAtSize(txt, 9);
  page.drawText(txt, { x: x + width - tw, y, size: 9, font: amtFont, color });
}

// ISO date-only string ("2026-06-01") → "1 Jun 2026". No Date parsing, to avoid
// timezone drift shifting the day on date-only values.
function fmtISODate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, dd] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !dd) return "";
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

// "1 Jun 2026 – 30 Jun 2026" from the run's period bounds; falls back to the
// month/year label when the explicit range isn't available.
function fmtPeriodRange(d: PayslipData): string {
  const start = fmtISODate(d.periodStart);
  const end = fmtISODate(d.periodEnd);
  if (start && end) return `${start} – ${end}`;
  return `${MONTHS[d.periodMonth - 1]} ${d.periodYear}`;
}

function fmtRM(n: number): string {
  return `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maskAccount(acct: string | null): string {
  if (!acct) return "—";
  if (acct.length <= 4) return acct;
  return `••••${acct.slice(-4)}`;
}

// ─── Data assembly (shared so backoffice + staff build identical records) ───

// payday is stored as a date-only / timestamp string. Render "3 Jul 2026"
// without Date parsing so a date-only value can't drift a day across timezones.
function fmtPayDate(payday: string | null | undefined): string | null {
  if (!payday) return null;
  const [y, m, d] = String(payday).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function prettyAllowance(key: string): string {
  const map: Record<string, string> = {
    attendance: "Attendance Allowance",
    performance: "Performance Allowance",
    unpaid_leave: "Unpaid Leave",
    zakat: "Zakat",
    review_penalty: "Review Penalty",
  };
  return map[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PayslipYtd = { gross: number; epf: number; socso: number; eis: number; pcb: number; net: number };

export type PayslipRunRow = {
  period_month: number;
  period_year: number;
  payday?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

export type PayslipUserRow = {
  name?: string | null;
  fullName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  outletName?: string | null;
};

export type PayslipProfileRow = {
  ic_number?: string | null;
  position?: string | null;
  epf_number?: string | null;
  socso_number?: string | null;
  tax_number?: string | null;
};

// A hr_payroll_items row (arbitrary shape — numeric columns read via Number()).
type PayslipItemRow = Record<string, unknown>;
type PayslipCompanyRow = Record<string, unknown> | null | undefined;

// Map ONE payroll item (+ its run, employee, profile, company, YTD) into the
// PayslipData the renderer consumes. Pure — no DB access — so both the admin
// and the staff self-service route produce the exact same payslip.
export function mapPayslipData(
  it: PayslipItemRow,
  ctx: {
    run: PayslipRunRow;
    user?: PayslipUserRow;
    profile?: PayslipProfileRow;
    company?: PayslipCompanyRow;
    ytd?: PayslipYtd;
  },
): PayslipData {
  const { run, user: u, profile: p, company, ytd } = ctx;
  const num = (v: unknown) => Number((v as number) || 0);

  const alloc = (it.allowances as Record<string, { amount: number; base?: number }> | null) || {};
  const allowanceList = Object.entries(alloc)
    .map(([k, v]) => ({ label: prettyAllowance(k), amount: Number(v?.amount || 0) }))
    .filter((a) => a.amount > 0);

  // Catch-all for earnings not itemized into OT or allowances.
  // BrioHR-imported rows store the gap in computation_details.gross_additions.
  const compDetails = (it.computation_details as Record<string, unknown> | null) || {};
  const otherEarnings: { label: string; amount: number }[] = [];
  const briohrAdditions = Number(compDetails.gross_additions || 0);
  if (briohrAdditions > 0) {
    const label = compDetails.source === "briohr_import" ? "Additions (imported)" : "Additions";
    otherEarnings.push({ label, amount: briohrAdditions });
  }

  const other = (it.other_deductions as Record<string, unknown>) || {};
  const unpaidLeave = Number(other.unpaid_leave || 0);
  const zakat = Number(other.zakat || 0);
  const reviewPenalty = Number((other.review_penalty as { amount?: number })?.amount || 0);
  const otherDeductions: { label: string; amount: number }[] = [];
  for (const [k, v] of Object.entries(other)) {
    if (["unpaid_leave", "zakat", "review_penalty"].includes(k)) continue;
    const amt = typeof v === "number" ? v : Number((v as { amount?: number })?.amount || 0);
    if (amt > 0) otherDeductions.push({ label: prettyAllowance(k), amount: amt });
  }

  const c = (company || {}) as Record<string, unknown>;
  const cstr = (k: string) => (c[k] as string | null | undefined) || null;

  return {
    employeeName: u?.name || "—",
    employeeFullName: u?.fullName || null,
    icNumber: p?.ic_number || null,
    position: p?.position || null,
    outlet: u?.outletName || null,
    epfNumber: p?.epf_number || null,
    socsoNumber: p?.socso_number || null,
    taxNumber: p?.tax_number || null,
    bankName: u?.bankName || null,
    bankAccountNumber: u?.bankAccountNumber || null,
    periodMonth: run.period_month,
    periodYear: run.period_year,
    paymentDate: fmtPayDate(run.payday),
    periodStart: run.period_start || null,
    periodEnd: run.period_end || null,
    basicSalary: num(it.basic_salary),
    regularHours: num(it.total_regular_hours),
    otHours: num(it.total_ot_hours),
    ot1xAmount: num(it.ot_1x_amount),
    ot1_5xAmount: num(it.ot_1_5x_amount),
    ot2xAmount: num(it.ot_2x_amount),
    ot3xAmount: num(it.ot_3x_amount),
    allowances: allowanceList,
    otherEarnings,
    gross: num(it.total_gross),
    epfEmployee: num(it.epf_employee),
    socsoEmployee: num(it.socso_employee),
    eisEmployee: num(it.eis_employee),
    pcbTax: num(it.pcb_tax),
    zakat,
    unpaidLeave,
    reviewPenalty,
    otherDeductions,
    totalDeductions: num(it.total_deductions),
    netPay: num(it.net_pay),
    epfEmployer: num(it.epf_employer),
    socsoEmployer: num(it.socso_employer),
    eisEmployer: num(it.eis_employer),
    ytdGross: ytd?.gross,
    ytdEpf: ytd?.epf,
    ytdSocso: ytd?.socso,
    ytdEis: ytd?.eis,
    ytdPcb: ytd?.pcb,
    ytdNet: ytd?.net,
    companyName: cstr("company_name") || "Celsius Coffee Sdn. Bhd.",
    companySSM: cstr("ssm_number"),
    companyRegNo: cstr("registration_number"),
    companyAddress:
      [c.address_line1, c.address_line2, c.postcode, c.city, c.country].filter(Boolean).join(", ") || null,
    companyLhdnE: cstr("lhdn_e_number"),
    employerEpfNumber: cstr("employer_epf_number"),
    employerSocsoNumber: cstr("employer_socso_number"),
    disclaimer: c.payslip_disclaimer_enabled ? ((c.payslip_disclaimer_text as string | null) ?? null) : null,
  };
}

// Year-to-date per user, accumulated over every prior confirmed/paid run in the
// same year PLUS the current run's items. The BrioHR-imported months land as
// `paid` runs, so a mid-/late-year payslip's YTD already spans the BrioHR
// period. Kept here (not in each route) so both surfaces sum YTD identically.
export async function computePayslipYtd(
  client: SupabaseClient,
  opts: { periodYear: number; periodMonth: number; userIds: string[]; currentItems: PayslipItemRow[] },
): Promise<Map<string, PayslipYtd>> {
  const { periodYear, periodMonth, userIds, currentItems } = opts;
  const ytdByUser = new Map<string, PayslipYtd>();
  const zero = (): PayslipYtd => ({ gross: 0, epf: 0, socso: 0, eis: 0, pcb: 0, net: 0 });
  const add = (userId: string, row: Record<string, unknown>) => {
    const ex = ytdByUser.get(userId) || zero();
    ex.gross += Number(row.total_gross || 0);
    ex.epf += Number(row.epf_employee || 0);
    ex.socso += Number(row.socso_employee || 0);
    ex.eis += Number(row.eis_employee || 0);
    ex.pcb += Number(row.pcb_tax || 0);
    ex.net += Number(row.net_pay || 0);
    ytdByUser.set(userId, ex);
  };

  const { data: priorRuns } = await client
    .from("hr_payroll_runs")
    .select("id")
    .eq("period_year", periodYear)
    .lt("period_month", periodMonth)
    .in("status", ["confirmed", "paid"]);
  const priorRunIds = (priorRuns || []).map((r: { id: string }) => r.id);
  if (priorRunIds.length > 0) {
    const { data: priorItems } = await client
      .from("hr_payroll_items")
      .select("user_id, total_gross, epf_employee, socso_employee, eis_employee, pcb_tax, net_pay")
      .in("payroll_run_id", priorRunIds)
      .in("user_id", userIds);
    for (const p of priorItems || []) add(p.user_id as string, p);
  }
  for (const it of currentItems) add(it.user_id as string, it);
  return ytdByUser;
}
