import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Generate a clean A4 purchase-order PDF from an order, so a COLD supplier (24h window closed)
// can receive the FULL order in one WhatsApp message — attached as the document header of an
// approved template — instead of a "reply for details" prompt. Uses pdf-lib (already a dep;
// works in serverless, no headless browser). Kept deliberately simple: one item per line,
// paginates if a PO is unusually long.
export interface PoPdfInput {
  orderNumber: string;
  outletName: string;
  outletAddress?: string | null;
  date: string; // YYYY-MM-DD
  deliveryDate?: string | null;
  items: { name: string; quantity: number; uom: string }[];
}

const A4: [number, number] = [595.28, 841.89];
const MX = 48; // left/right margin

export async function generatePoPdf(input: PoPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.11, 0.11, 0.11);
  const gray = rgb(0.42, 0.42, 0.42);
  const rule = rgb(0.85, 0.85, 0.85);

  let page = doc.addPage(A4);
  const width = page.getWidth();
  const qtyX = width - MX - 110;
  let y = 792;

  const newPageIfNeeded = () => {
    if (y < 80) {
      page = doc.addPage(A4);
      y = 792;
    }
  };
  const text = (s: string, x: number, size: number, f = font, color = dark) =>
    page.drawText(s, { x, y, size, font: f, color });
  const hr = (thickness = 1) => {
    page.drawLine({ start: { x: MX, y }, end: { x: width - MX, y }, thickness, color: rule });
  };

  // Header
  text("PURCHASE ORDER", MX, 20, bold);
  y -= 26;
  text(input.outletName, MX, 13, bold);
  y -= 20;
  text(`PO #: ${input.orderNumber}`, MX, 11, font, gray);
  y -= 15;
  text(`Date: ${input.date}`, MX, 11, font, gray);
  y -= 14;
  hr();
  y -= 22;

  // Item header
  text("Item", MX, 10, bold, gray);
  text("Qty", qtyX, 10, bold, gray);
  y -= 17;

  // Items — item name + the order quantity as a plain number in the Qty column, with the pack
  // unit on a light sub-line beneath the name. Keeps the qty ("2") from running into a pack
  // label that itself starts with a number (e.g. "1 Cake (12 slices)" was rendering as a
  // confusing "2 1 Cake (12 slices)").
  input.items.forEach((it, i) => {
    newPageIfNeeded();
    const label = `${i + 1}. ${it.name}`;
    text(label.length > 58 ? label.slice(0, 57) + "…" : label, MX, 11);
    text(String(it.quantity), qtyX, 11, bold);
    y -= 13;
    const unit = it.uom.replace(/^\s*1\s+/, "").trim(); // drop a redundant leading "1 "
    if (unit) text(`× ${unit}`, MX + 14, 9, font, gray);
    y -= 15;
  });

  y -= 8;
  newPageIfNeeded();
  hr(0.5);
  y -= 22;

  if (input.deliveryDate) {
    text(`Delivery date: ${input.deliveryDate}`, MX, 11, bold);
    y -= 18;
  }
  if (input.outletAddress) {
    text("Deliver to:", MX, 11, bold);
    y -= 15;
    for (const ln of wrap(input.outletAddress, 78)) {
      newPageIfNeeded();
      text(ln, MX, 11, font, gray);
      y -= 14;
    }
  }
  y -= 12;
  newPageIfNeeded();
  text("Thank you.", MX, 12, bold);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// Greedy word wrap to `max` chars per line (address is short; approximate width is fine).
function wrap(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      if (line) out.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) out.push(line);
  return out;
}
