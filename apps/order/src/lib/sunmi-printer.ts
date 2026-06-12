/**
 * Sunmi V3 built-in thermal printer integration.
 *
 * When running in the Sunmi browser (or a WebView with the JS bridge injected),
 * `window.PrinterInterface` is available for direct ESC/POS-style printing.
 *
 * Detection priority:
 * 1. Sunmi JS bridge (PrinterInterface) — direct to built-in printer
 * 2. Canvas → image → Sunmi bitmap print
 * 3. Fallback: window.print() for non-Sunmi devices
 */

declare global {
  interface Window {
    PrinterInterface?: SunmiPrinterInterface;
    sunmiInnerPrinter?: SunmiPrinterInterface;
  }
}

interface SunmiPrinterInterface {
  printerInit: () => void;
  printerSelfChecking: () => void;
  setFontSize: (size: number) => void;
  setAlignment: (align: number) => void; // 0=left, 1=center, 2=right
  printText: (text: string) => void;
  printTextWithFont: (text: string, typeface: string, size: number) => void;
  printOriginalText: (text: string) => void;
  printBitmap: (base64: string, width: number, height: number) => void;
  printBarCode: (data: string, symbology: number, width: number, height: number, textPos: number) => void;
  printQRCode: (data: string, moduleSize: number, errorLevel: number) => void;
  lineWrap: (lines: number) => void;
  cutPaper: () => void;
  setStyle: (key: string, value: string) => void;
  commitPrinterBuffer: () => void;
  enterPrinterBuffer: (clean: boolean) => void;
  exitPrinterBuffer: (commit: boolean) => void;
}

function getPrinter(): SunmiPrinterInterface | null {
  if (typeof window === "undefined") return null;
  return window.PrinterInterface ?? window.sunmiInnerPrinter ?? null;
}

export function isSunmiDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("sunmi") || getPrinter() !== null;
}

export function hasSunmiPrinter(): boolean {
  return getPrinter() !== null;
}

// ─── Text-based ESC/POS style printing via Sunmi bridge ───

const ALIGN_LEFT = 0;
const ALIGN_CENTER = 1;

type ReceiptLine = {
  text: string;
  size?: number;       // font size (default 24)
  align?: number;      // 0=left, 1=center, 2=right
  bold?: boolean;
};

function printLines(lines: ReceiptLine[]) {
  const printer = getPrinter();
  if (!printer) return false;

  try {
    printer.printerInit();

    for (const line of lines) {
      printer.setAlignment(line.align ?? ALIGN_LEFT);
      const size = line.size ?? 24;

      if (line.bold) {
        printer.printTextWithFont(line.text + "\n", "", size);
      } else {
        printer.setFontSize(size);
        printer.printText(line.text + "\n");
      }
    }

    printer.lineWrap(4);
    return true;
  } catch (e) {
    console.error("Sunmi print error:", e);
    return false;
  }
}

// ─── Kitchen Slip ───

export type PrintableOrder = {
  order_number: string;
  store_name: string;
  created_at: string;
  notes?: string | null;
  total: number;
  items: {
    quantity: number;
    product_name: string;
    modifiers?: string;
    specialInstructions?: string;
  }[];
};

const DASH_LINE = "--------------------------------";

export function sunmiPrintKitchenSlip(order: PrintableOrder): boolean {
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines: ReceiptLine[] = [
    { text: "KITCHEN ORDER", size: 24, align: ALIGN_CENTER, bold: true },
    { text: "", size: 16 },
    { text: "Celsius Coffee", size: 28, align: ALIGN_CENTER, bold: true },
    { text: order.store_name, size: 20, align: ALIGN_CENTER },
    { text: DASH_LINE, size: 20, align: ALIGN_CENTER },
    { text: `#${order.order_number}`, size: 52, align: ALIGN_CENTER, bold: true },
    { text: time, size: 20, align: ALIGN_CENTER },
    { text: DASH_LINE, size: 20, align: ALIGN_CENTER },
  ];

  for (const item of order.items) {
    lines.push({
      text: `${item.quantity}x ${item.product_name}`,
      size: 28,
      bold: true,
    });
    if (item.modifiers) {
      lines.push({ text: `  ${item.modifiers}`, size: 22 });
    }
    if (item.specialInstructions) {
      lines.push({ text: `  * ${item.specialInstructions}`, size: 22 });
    }
  }

  if (order.notes) {
    lines.push({ text: DASH_LINE, size: 20 });
    lines.push({ text: `NOTE: ${order.notes}`, size: 24, bold: true });
  }

  lines.push({ text: DASH_LINE, size: 20, align: ALIGN_CENTER });
  lines.push({ text: "SELF-PICKUP", size: 20, align: ALIGN_CENTER });

  return printLines(lines);
}

// ─── Customer Receipt ───

export function sunmiPrintReceipt(
  order: PrintableOrder & {
    subtotal: number;
    discount_amount?: number;
    voucher_code?: string;
    reward_discount_amount?: number;
    reward_name?: string;
    sst_amount?: number;
    payment_method?: string;
  },
): boolean {
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = new Date(order.created_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const fmt = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

  const lines: ReceiptLine[] = [
    { text: "Celsius Coffee", size: 28, align: ALIGN_CENTER, bold: true },
    { text: order.store_name, size: 20, align: ALIGN_CENTER },
    { text: `${date}  ${time}`, size: 18, align: ALIGN_CENTER },
    { text: DASH_LINE, size: 20, align: ALIGN_CENTER },
    { text: `#${order.order_number}`, size: 42, align: ALIGN_CENTER, bold: true },
    { text: DASH_LINE, size: 20, align: ALIGN_CENTER },
  ];

  for (const item of order.items) {
    lines.push({
      text: `${item.quantity}x ${item.product_name}`,
      size: 24,
      bold: true,
    });
    if (item.modifiers) {
      lines.push({ text: `  ${item.modifiers}`, size: 20 });
    }
  }

  lines.push({ text: DASH_LINE, size: 20, align: ALIGN_CENTER });
  lines.push({ text: `Subtotal          ${fmt(order.subtotal)}`, size: 22 });

  if (order.discount_amount && order.discount_amount > 0) {
    lines.push({
      text: `Voucher (${order.voucher_code ?? ""})  -${fmt(order.discount_amount)}`,
      size: 20,
    });
  }
  if (order.reward_discount_amount && order.reward_discount_amount > 0) {
    lines.push({
      text: `Reward   -${fmt(order.reward_discount_amount)}`,
      size: 20,
    });
  }
  if (order.sst_amount && order.sst_amount > 0) {
    lines.push({ text: `SST (6%)          ${fmt(order.sst_amount)}`, size: 20 });
  }

  lines.push({ text: DASH_LINE, size: 20, align: ALIGN_CENTER });
  lines.push({
    text: `TOTAL  ${fmt(order.total)}`,
    size: 28,
    bold: true,
  });

  if (order.payment_method) {
    lines.push({
      text: `Payment: ${order.payment_method.toUpperCase().replace(/_/g, " ")}`,
      size: 18,
    });
  }

  lines.push({ text: DASH_LINE, size: 20, align: ALIGN_CENTER });
  lines.push({ text: "Thank you!", size: 22, align: ALIGN_CENTER });
  lines.push({ text: "Self-pickup • Celsius Coffee", size: 18, align: ALIGN_CENTER });

  return printLines(lines);
}
