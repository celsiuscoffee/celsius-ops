// Confirmation Letter PDF generator — A4 portrait, single page.
// Issued at the end of probation (or on-demand). Mirrors the LoE format.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  noticePeriod: string; // e.g. "two (2) calendar months"
  companyName: string;
  companySSM: string | null;
  companyAddress: string | null;
  signatoryName: string;
  signatoryTitle: string;
};

export async function generateConfirmationLetterPDF(data: ConfirmationLetterData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  // Letterhead
  const logoBytes = loadLogoBytes();
  if (logoBytes) {
    try {
      const img = await pdf.embedJpg(logoBytes);
      const imgDims = img.scale(40 / img.height);
      page.drawImage(img, { x: 50, y: y - imgDims.height + 30, width: imgDims.width, height: imgDims.height });
    } catch {
      /* ignore logo failure */
    }
  }
  drawTextRight(page, data.companyName, helvBold, 9, 545, y + 30);
  if (data.companySSM) drawTextRight(page, data.companySSM, helv, 8, 545, y + 18);
  if (data.companyAddress) {
    const lines = data.companyAddress.split(",").map((l) => l.trim()).filter(Boolean);
    let yy = y + 8;
    for (const line of lines.slice(0, 3)) {
      drawTextRight(page, line, helv, 8, 545, yy);
      yy -= 10;
    }
  }

  y = 720;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });

  // Date
  y -= 30;
  page.drawText(formatDate(data.confirmationDate), { x: 50, y, size: 10, font: helv });

  // Recipient
  y -= 30;
  page.drawText(`To: ${data.employeeFullName}`, { x: 50, y, size: 10, font: helv });
  if (data.icNumber) {
    y -= 14;
    page.drawText(`NRIC: ${data.icNumber}`, { x: 50, y, size: 10, font: helv });
  }

  // Subject
  y -= 30;
  page.drawText("SUBJECT: CONFIRMATION OF EMPLOYMENT", { x: 50, y, size: 11, font: helvBold });

  // Body
  y -= 25;
  const para1 =
    `Dear ${data.employeeFullName},`;
  page.drawText(para1, { x: 50, y, size: 10, font: helv });

  y -= 22;
  const para2 =
    `We are pleased to confirm your employment with ${data.companyName} as ${data.position}, ` +
    `effective ${formatDate(data.confirmationDate)}.`;
  y = wrapText(page, para2, helv, 10, 50, y, 495, 14);

  y -= 14;
  const para3 =
    `Following the satisfactory completion of your three (3) month probationary ` +
    `period (commenced ${formatDate(data.joinDate)}), your appointment is now confirmed on a ` +
    `permanent basis, subject to the terms and conditions of the Letter of Offer of Employment ` +
    `previously issued to you.`;
  y = wrapText(page, para3, helv, 10, 50, y, 495, 14);

  y -= 14;
  const para4 =
    `Your monthly base salary remains at RM ${data.basicSalary.toLocaleString("en-MY", { minimumFractionDigits: 2 })}, ` +
    `payable on or before the 7th of each month, less applicable statutory deductions ` +
    `(EPF, SOCSO, EIS, and PCB where applicable).`;
  y = wrapText(page, para4, helv, 10, 50, y, 495, 14);

  y -= 14;
  const para5 =
    `As a confirmed employee, your notice period for termination is ${data.noticePeriod}, ` +
    `or payment in lieu, in accordance with your Letter of Offer.`;
  y = wrapText(page, para5, helv, 10, 50, y, 495, 14);

  y -= 14;
  page.drawText(
    "On behalf of the management, we thank you for your contribution during the probation period",
    { x: 50, y, size: 10, font: helv },
  );
  y -= 12;
  page.drawText(
    "and look forward to your continued commitment and growth with the company.",
    { x: 50, y, size: 10, font: helv },
  );

  // Signature block
  y -= 40;
  page.drawText("Yours faithfully,", { x: 50, y, size: 10, font: helv });
  y -= 50;
  page.drawText("...........................................", { x: 50, y, size: 10, font: helv });
  y -= 14;
  page.drawText(`(${data.signatoryName.toUpperCase()})`, { x: 50, y, size: 10, font: helvBold });
  y -= 12;
  page.drawText(data.signatoryTitle, { x: 50, y, size: 10, font: helv });
  y -= 12;
  page.drawText(data.companyName, { x: 50, y, size: 10, font: helv });

  // Acknowledgement
  y -= 50;
  page.drawText("Acknowledged & received by:", { x: 50, y, size: 10, font: helv });
  y -= 50;
  page.drawText("...........................................", { x: 50, y, size: 10, font: helv });
  y -= 14;
  page.drawText(`(${data.employeeFullName.toUpperCase()})`, { x: 50, y, size: 10, font: helvBold });
  if (data.icNumber) {
    y -= 12;
    page.drawText(`NRIC: ${data.icNumber}`, { x: 50, y, size: 10, font: helv });
  }
  y -= 12;
  page.drawText("Date: ............................................", { x: 50, y, size: 10, font: helv });

  return pdf.save();
}

function drawTextRight(page: PDFPage, text: string, font: PDFFont, size: number, rightX: number, y: number) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y, size, font });
}

function wrapText(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(/\s+/);
  let line = "";
  let cursor = y;
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      page.drawText(line, { x, y: cursor, size, font });
      cursor -= lineHeight;
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) {
    page.drawText(line, { x, y: cursor, size, font });
    cursor -= lineHeight;
  }
  return cursor;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
