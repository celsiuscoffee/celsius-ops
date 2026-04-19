// Payslip PDF generator — A4 portrait, one page per employee.
// Uses pdf-lib (already a dep) for zero-dep rendering.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
  otHours: number;
  ot1xAmount: number;
  ot1_5xAmount: number;
  ot2xAmount: number;
  ot3xAmount: number;
  allowances: { label: string; amount: number }[];
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

export async function generatePayslipPDF(data: PayslipData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 in points
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  drawPayslip(page, font, bold, data);
  return pdf.save();
}

// Multi-employee bundle into a single PDF
export async function generatePayslipBundlePDF(records: PayslipData[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const data of records) {
    const page = pdf.addPage([595.28, 841.89]);
    drawPayslip(page, font, bold, data);
  }
  return pdf.save();
}

function drawPayslip(page: PDFPage, font: PDFFont, bold: PDFFont, d: PayslipData) {
  const W = 595.28;
  const H = 841.89;
  const M = 36; // margin
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const terracotta = rgb(0.76, 0.27, 0.18);

  let y = H - M;

  // Header — company
  page.drawText(d.companyName, { x: M, y, size: 14, font: bold, color: terracotta });
  y -= 14;
  if (d.companySSM) {
    page.drawText(`SSM: ${d.companySSM}`, { x: M, y, size: 8, font, color: gray });
    y -= 10;
  }
  if (d.companyAddress) {
    page.drawText(d.companyAddress, { x: M, y, size: 8, font, color: gray });
    y -= 10;
  }
  if (d.companyLhdnE) {
    page.drawText(`Employer Tax E: ${d.companyLhdnE}`, { x: M, y, size: 8, font, color: gray });
    y -= 10;
  }

  // Title
  y -= 6;
  page.drawText("PAYSLIP", { x: M, y, size: 16, font: bold, color: black });
  page.drawText(`${MONTHS[d.periodMonth - 1]} ${d.periodYear}`, {
    x: W - M - 80, y, size: 12, font: bold, color: black,
  });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: terracotta });
  y -= 16;

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
    if (d.ot1xAmount > 0) earnings.push([`OT (1.0× rate, ${d.otHours.toFixed(1)}h total)`, d.ot1xAmount]);
    if (d.ot1_5xAmount > 0) earnings.push(["OT (1.5×)", d.ot1_5xAmount]);
    if (d.ot2xAmount > 0) earnings.push(["OT (2.0× / rest day)", d.ot2xAmount]);
    if (d.ot3xAmount > 0) earnings.push(["OT (3.0× / public holiday)", d.ot3xAmount]);
  }
  for (const a of d.allowances) {
    if (a.amount > 0) earnings.push([a.label, a.amount]);
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

  // Net Pay
  page.drawRectangle({ x: M, y: y - 30, width: W - 2 * M, height: 30, color: terracotta });
  page.drawText("NET PAY", { x: M + 12, y: y - 20, size: 12, font: bold, color: rgb(1, 1, 1) });
  const netText = fmtRM(d.netPay);
  const netWidth = bold.widthOfTextAtSize(netText, 16);
  page.drawText(netText, { x: W - M - netWidth - 12, y: y - 22, size: 16, font: bold, color: rgb(1, 1, 1) });
  y -= 44;

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

  // Footer
  y = M + 20;
  if (d.disclaimer) {
    page.drawText(d.disclaimer, { x: M, y, size: 7, font, color: gray, maxWidth: W - 2 * M });
    y -= 10;
  }
  page.drawText("This is a computer-generated payslip and does not require a signature.", {
    x: M, y: M + 6, size: 7, font, color: gray,
  });
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
