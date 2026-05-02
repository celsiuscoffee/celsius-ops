// Payslip PDF generator — A4 portrait, one page per employee.
// Uses pdf-lib (already a dep) for zero-dep rendering.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
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
  // YTD
  ytdGross?: number;
  ytdEpf?: number;
  ytdSocso?: number;
  ytdPcb?: number;
  // Company
  companyName: string;
  companySSM: string | null;
  companyAddress: string | null;
  companyLhdnE: string | null;
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
  if (d.companySSM) {
    page.drawText(`SSM: ${d.companySSM}`, { x: textX, y, size: 8, font, color: gray });
    y -= 10;
  }
  if (d.companyAddress) {
    page.drawText(d.companyAddress, { x: textX, y, size: 8, font, color: gray });
    y -= 10;
  }
  if (d.companyLhdnE) {
    page.drawText(`Employer Tax E: ${d.companyLhdnE}`, { x: textX, y, size: 8, font, color: gray });
    y -= 10;
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
    ["Payment Date", d.paymentDate || "—", "", ""],
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
  const tableTop = y;
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
    if (d.ot2xAmount > 0) earnings.push(["OT (2.0× rest day)", d.ot2xAmount]);
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
      ["Gross YTD", d.ytdGross ?? 0],
      ["EPF YTD", d.ytdEpf ?? 0],
      ["SOCSO YTD", d.ytdSocso ?? 0],
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
  // Payslip reference: PAY-YYYYMM-LASTNAME (no PII beyond what's already on the page)
  const surname = (d.employeeFullName || d.employeeName || "").split(/\s+/).slice(-1)[0] || "";
  const ref = `PAY-${d.periodYear}${String(d.periodMonth).padStart(2, "0")}-${surname.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
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

function fmtRM(n: number): string {
  return `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maskAccount(acct: string | null): string {
  if (!acct) return "—";
  if (acct.length <= 4) return acct;
  return `••••${acct.slice(-4)}`;
}
