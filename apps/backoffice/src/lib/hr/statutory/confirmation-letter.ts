// Confirmation Letter PDF — A4 portrait, single page.
// Issued at the end of probation (or on-demand). Mirrors the LoE format with
// a Key Terms box up top so the document reads like a proper formal letter
// rather than a wall of paragraphs.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { readFileSync } from "fs";
import { join } from "path";

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

export type ConfirmationLetterData = {
  employeeFullName: string;
  icNumber: string | null;
  position: string;
  joinDate: string;
  confirmationDate: string;
  basicSalary: number;
  noticePeriod: string;        // e.g. "two (2) calendar months"
  companyName: string;
  companySSM: string | null;
  companyAddress: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  signatoryName: string;
  signatoryTitle: string;
  signatureImageBytes?: Uint8Array | null;
  signedOnDate?: string | null;
};

export async function generateConfirmationLetterPDF(data: ConfirmationLetterData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 50; // page margin

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.85, 0.85, 0.85);
  const tintBg = rgb(0.985, 0.97, 0.96); // very light terracotta wash for box
  // Brand terracotta — matches payslip + globals.css --color-terracotta
  const terracotta = rgb(0xC2 / 255, 0x45 / 255, 0x2D / 255);

  // Top brand bar so every Celsius letter has a recognisable accent
  page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: terracotta });

  let y = H - M;

  // ── Letterhead ───────────────────────────────────────────────
  let logo: PDFImage | null = null;
  const logoBytes = loadLogoBytes();
  if (logoBytes) {
    try {
      logo = await pdf.embedJpg(logoBytes);
    } catch { /* ignore */ }
  }
  const LOGO_SIZE = 50;
  if (logo) {
    page.drawImage(logo, { x: M, y: y - LOGO_SIZE + 14, width: LOGO_SIZE, height: LOGO_SIZE });
  }
  // Right-aligned company block
  drawTextRight(page, data.companyName, bold, 11, W - M, y + 8, terracotta);
  let rightY = y - 4;
  if (data.companySSM) {
    drawTextRight(page, data.companySSM, helv, 8, W - M, rightY, gray);
    rightY -= 10;
  }
  if (data.companyAddress) {
    const lines = data.companyAddress.split(",").map((s) => s.trim()).filter(Boolean);
    for (const line of lines.slice(0, 3)) {
      drawTextRight(page, line, helv, 8, W - M, rightY, gray);
      rightY -= 10;
    }
  }
  if (data.companyEmail) {
    drawTextRight(page, data.companyEmail, helv, 8, W - M, rightY, gray);
    rightY -= 10;
  }
  if (data.companyPhone) {
    drawTextRight(page, data.companyPhone, helv, 8, W - M, rightY, gray);
    rightY -= 10;
  }
  // Settle y to whichever of (logo bottom, header right block bottom) is lower
  const logoBottomY = logo ? H - M - LOGO_SIZE + 8 : y - 14;
  y = Math.min(logoBottomY, rightY) - 6;

  // Divider rule
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lightGray });
  y -= 22;

  // ── Date + Recipient ─────────────────────────────────────────
  page.drawText(formatDate(data.confirmationDate), { x: M, y, size: 10, font: helv, color: black });
  y -= 26;
  page.drawText(`To: ${data.employeeFullName}`, { x: M, y, size: 10, font: helv, color: black });
  if (data.icNumber) {
    y -= 13;
    page.drawText(`NRIC: ${data.icNumber}`, { x: M, y, size: 10, font: helv, color: gray });
  }

  // ── Subject ──────────────────────────────────────────────────
  y -= 28;
  page.drawText("SUBJECT:", { x: M, y, size: 10, font: bold, color: terracotta });
  page.drawText("CONFIRMATION OF EMPLOYMENT", { x: M + 56, y, size: 10, font: bold, color: black });
  // Underline rule
  page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.5, color: terracotta });
  y -= 22;

  // ── Key Terms box ─────────────────────────────────────────────
  const BOX_PAD = 12;
  const KEY_ROWS: Array<[string, string]> = [
    ["Position", data.position],
    ["Effective Date", formatDate(data.confirmationDate)],
    ["Probation Started", formatDate(data.joinDate)],
    ["Base Salary", `RM ${data.basicSalary.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per month`],
    ["Notice Period", data.noticePeriod],
  ];
  const BOX_LINE_H = 16;
  const BOX_HEADER_H = 22;
  const BOX_H = BOX_HEADER_H + KEY_ROWS.length * BOX_LINE_H + BOX_PAD;
  // Box background
  page.drawRectangle({
    x: M, y: y - BOX_H, width: W - 2 * M, height: BOX_H,
    color: tintBg, borderColor: terracotta, borderWidth: 0.6,
  });
  // Box header strip
  page.drawRectangle({
    x: M, y: y - BOX_HEADER_H, width: W - 2 * M, height: BOX_HEADER_H,
    color: terracotta,
  });
  page.drawText("KEY TERMS", { x: M + BOX_PAD, y: y - 15, size: 10, font: bold, color: rgb(1, 1, 1) });
  // Box rows
  let rowY = y - BOX_HEADER_H - BOX_PAD + 4;
  for (const [label, value] of KEY_ROWS) {
    page.drawText(label, { x: M + BOX_PAD, y: rowY, size: 9, font: helv, color: gray });
    page.drawText(value, { x: M + BOX_PAD + 130, y: rowY, size: 10, font: bold, color: black });
    rowY -= BOX_LINE_H;
  }
  y -= BOX_H + 18;

  // ── Body ──────────────────────────────────────────────────────
  const BODY = 10;
  const LH = 14;
  page.drawText(`Dear ${data.employeeFullName},`, { x: M, y, size: BODY, font: helv, color: black });
  y -= LH + 6;

  y = wrapText(page, helv, BODY, M, y, W - 2 * M, LH, color(black),
    `We are pleased to confirm your employment with ${data.companyName} as ${data.position}, ` +
    `effective ${formatDate(data.confirmationDate)}.`,
  );
  y -= 8;

  y = wrapText(page, helv, BODY, M, y, W - 2 * M, LH, color(black),
    `Following the satisfactory completion of your three (3) month probationary period ` +
    `(commenced ${formatDate(data.joinDate)}), your appointment is now confirmed on a permanent ` +
    `basis, subject to the terms and conditions of the Letter of Offer of Employment previously issued to you.`,
  );
  y -= 8;

  y = wrapText(page, helv, BODY, M, y, W - 2 * M, LH, color(black),
    `Your monthly base salary remains as stated above, payable on or before the 7th of each month, ` +
    `less applicable statutory deductions (EPF, SOCSO, EIS, and PCB where applicable). ` +
    `As a confirmed employee, your notice period for termination is ${data.noticePeriod}, or payment in lieu, ` +
    `in accordance with your Letter of Offer.`,
  );
  y -= 8;

  y = wrapText(page, helv, BODY, M, y, W - 2 * M, LH, color(black),
    `On behalf of the management, we thank you for your contribution during the probation period and ` +
    `look forward to your continued commitment and growth with the company.`,
  );

  // ── Signature block ──────────────────────────────────────────
  y -= 26;
  page.drawText("Yours faithfully,", { x: M, y, size: BODY, font: helv, color: black });
  y -= 50;

  if (data.signatureImageBytes && data.signatureImageBytes.byteLength > 0) {
    try {
      const sigImg = await pdf.embedPng(data.signatureImageBytes);
      const targetH = 42;
      const scale = targetH / sigImg.height;
      const sigW = Math.min(sigImg.width * scale, 220);
      const sigH = sigImg.height * (sigW / sigImg.width);
      page.drawImage(sigImg, { x: M, y: y + 4, width: sigW, height: sigH });
    } catch {
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + 200, y: y + 4 }, thickness: 0.4, color: black });
    }
  } else {
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + 200, y: y + 4 }, thickness: 0.4, color: black });
  }

  y -= 4;
  page.drawText(data.signatoryName.toUpperCase(), { x: M, y, size: 10, font: bold, color: black });
  y -= 12;
  page.drawText(data.signatoryTitle, { x: M, y, size: 10, font: helv, color: black });
  y -= 12;
  page.drawText(data.companyName, { x: M, y, size: 10, font: helv, color: gray });
  if (data.signatureImageBytes && data.signedOnDate) {
    y -= 12;
    page.drawText(`Signed on ${formatDate(data.signedOnDate)}`, { x: M, y, size: 9, font: helv, color: gray });
  }

  // ── Acknowledgement ──────────────────────────────────────────
  y -= 50;
  page.drawText("Acknowledged & received by:", { x: M, y, size: BODY, font: bold, color: black });
  y -= 50;
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + 200, y: y + 4 }, thickness: 0.4, color: black });
  page.drawText(data.employeeFullName.toUpperCase(), { x: M, y, size: 10, font: bold, color: black });
  if (data.icNumber) {
    y -= 12;
    page.drawText(`NRIC: ${data.icNumber}`, { x: M, y, size: 10, font: helv, color: gray });
  }
  y -= 18;
  page.drawText("Date:", { x: M, y, size: 10, font: helv, color: black });
  page.drawLine({ start: { x: M + 40, y: y - 1 }, end: { x: M + 200, y: y - 1 }, thickness: 0.4, color: black });

  // ── Footer ───────────────────────────────────────────────────
  const footerY = M;
  page.drawLine({ start: { x: M, y: footerY + 16 }, end: { x: W - M, y: footerY + 16 }, thickness: 0.4, color: lightGray });
  page.drawText(
    `${data.companyName}${data.companySSM ? ` · ${data.companySSM}` : ""}${data.companyEmail ? ` · ${data.companyEmail}` : ""}`,
    { x: M, y: footerY + 4, size: 7, font: helv, color: gray },
  );
  drawTextRight(page, "Computer-generated. Authentic with company seal or signature.",
    helv, 7, W - M, footerY + 4, gray);

  return pdf.save();
}

// ── Helpers ─────────────────────────────────────────────────────

function color(c: ReturnType<typeof rgb>) { return c; }

function drawTextRight(
  page: PDFPage, text: string, font: PDFFont, size: number,
  rightX: number, y: number, c?: ReturnType<typeof rgb>,
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y, size, font, color: c ?? rgb(0, 0, 0) });
}

function wrapText(
  page: PDFPage, font: PDFFont, size: number,
  x: number, y: number, maxWidth: number, lineHeight: number,
  c: ReturnType<typeof rgb>, text: string,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cursor = y;
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      page.drawText(line, { x, y: cursor, size, font, color: c });
      cursor -= lineHeight;
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) {
    page.drawText(line, { x, y: cursor, size, font, color: c });
    cursor -= lineHeight;
  }
  return cursor;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
