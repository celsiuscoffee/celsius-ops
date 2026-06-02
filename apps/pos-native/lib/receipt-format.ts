/**
 * 80mm receipt + kitchen docket formatters — native port of
 * apps/pos/src/lib/sunmi-printer.ts (formatReceipt / formatKitchenDocket).
 *
 * These produce plain-text blocks whose LINE SHAPES the native SUNMI
 * module parses to apply size/bold/alignment (e.g. "2x Latte", "TOTAL",
 * "===" dividers, "** 12 **" big queue number). Keep the shapes in sync
 * with modules/sunmi-printer if you change either side.
 *
 * CHARS_PER_LINE (38) is calibrated for the D3's 80mm head at 24pt bold.
 */

const CHARS_PER_LINE = 38;

function padRight(str: string, len: number): string {
  return str.substring(0, len).padEnd(len);
}
function centerText(str: string): string {
  const pad = Math.max(0, Math.floor((CHARS_PER_LINE - str.length) / 2));
  return " ".repeat(pad) + str;
}
function divider(char = "-"): string {
  return char.repeat(CHARS_PER_LINE);
}
function twoColumn(left: string, right: string): string {
  const maxLeft = CHARS_PER_LINE - right.length - 1;
  return padRight(left, maxLeft) + " " + right;
}
/** Greedy word-wrap to a max width; hard-breaks any single token longer than
 *  the width so a long street name can never overflow the receipt line. */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

export interface OutletInfo {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
}

export interface ReceiptConfig {
  showLogo?: boolean;
  qrUrl?: string | null;
  qrLabel?: string | null;
  promoEnabled?: boolean;
  promoText?: string | null;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
}

export type ReceiptItem = {
  product_name: string;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  modifier_total: number;
  /** Net line total in sen (post line-discount). */
  item_total: number;
  /** Sen taken off this line (per-line manual discount). Optional —
   *  when present we print a "-RM x.xx" line under the item so the
   *  customer sees the deal. Stays absent for older orders. */
  discount_amount?: number;
  modifiers?: unknown;
  notes?: string | null;
};

export type ReceiptOrder = {
  order_number: string;
  order_type: string;
  table_number?: string | null;
  /** Label for table_number: "Table" (QR self-order) or "Stand" (counter). */
  table_label?: string;
  queue_number?: string | null;
  subtotal: number;
  service_charge: number;
  discount_amount: number;
  sst_amount: number;
  total: number;
  created_at: string;
  /** Order-level note (Grab delivery instruction / order comment, pickup note). */
  notes?: string | null;
  pos_order_items?: ReceiptItem[];
  pos_order_payments?: { payment_method: string; amount: number }[];
};

function formatOutletHeader(outlet: OutletInfo): string[] {
  const lines: string[] = [];
  // The logo already renders "Celsius Coffee", so show just the branch/location
  // here (strip the brand prefix) — avoids printing the name twice.
  const branch = outlet.name.replace(/^\s*celsius\s+coffee\s*/i, "").trim() || outlet.name;
  lines.push(centerText(branch));
  const addressParts: string[] = [];
  if (outlet.address) addressParts.push(outlet.address);
  if (outlet.city) addressParts.push(outlet.city);
  if (outlet.state) addressParts.push(outlet.state);
  if (addressParts.length > 0) {
    // Word-wrap so the address never overflows the line (break on spaces;
    // hard-break an over-long token). The old code split at a single comma and
    // let any leftover long line run off the edge of the paper.
    for (const ln of wrapText(addressParts.join(", "), CHARS_PER_LINE)) {
      lines.push(centerText(ln));
    }
  }
  if (outlet.phone) lines.push(centerText(`Tel: ${outlet.phone}`));
  return lines;
}

export function formatReceipt(
  order: ReceiptOrder,
  outlet: OutletInfo,
  config?: ReceiptConfig,
): {
  header: string;
  body: string;
  footer: string;
  showLogo: boolean;
  qrUrl: string;
  qrLabel: string;
  promoText: string;
} {
  const items = order.pos_order_items ?? [];
  const payments = order.pos_order_payments ?? [];
  const date = new Date(order.created_at);
  const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

  const headerLines = formatOutletHeader(outlet);

  const bodyLines: string[] = [];
  bodyLines.push("");            // breathing room below the logo + branch
  bodyLines.push(divider("="));
  bodyLines.push(twoColumn("Order:", order.order_number));
  bodyLines.push(
    twoColumn("Date:", date.toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" })),
  );
  bodyLines.push(
    twoColumn("Time:", date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })),
  );
  bodyLines.push(twoColumn("Type:", order.order_type === "dine_in" ? "Dine-in" : "Takeaway"));

  if (order.queue_number) {
    bodyLines.push("");
    bodyLines.push(centerText("QUEUE NUMBER"));
    bodyLines.push(centerText(`** ${order.queue_number} **`));
  }
  if (order.table_number) {
    const lbl = order.table_label ?? "Table";
    bodyLines.push(twoColumn(`${lbl}:`, lbl === "Stand" ? `#${order.table_number}` : order.table_number));
  }

  bodyLines.push(divider("="));

  for (const item of items) {
    const left = `${item.quantity}x ${item.product_name}`;
    // Show the GROSS line total + a discount line beneath it when a
    // per-line discount was applied, so the customer can see both the
    // original price and the deal. item_total is already the net.
    const lineDisc = item.discount_amount ?? 0;
    const lineGross = lineDisc > 0 ? item.item_total + lineDisc : item.item_total;
    bodyLines.push(twoColumn(left, rm(lineGross)));
    if (item.variant_name) bodyLines.push(`   ${item.variant_name}`);
    const mods = item.modifiers;
    if (Array.isArray(mods) && mods.length > 0) {
      const modNames = mods.map((m: any) => m.option?.name ?? m.name ?? m.group_name ?? "").filter(Boolean);
      if (modNames.length > 0) bodyLines.push(`   ${modNames.join(", ")}`);
    }
    if (lineDisc > 0) {
      bodyLines.push(twoColumn(`   Discount`, `-${rm(lineDisc)}`));
    }
    // Customer note as a small indented line (matches modifier lines). NOT
    // "** .. **" — that pattern is the native module's 48pt queue-number
    // renderer, which printed the note huge on the receipt.
    if (item.notes) bodyLines.push(`   ${item.notes}`);
  }

  // Order-level note (Grab delivery instruction / order comment, or a pickup
  // order note). Printed once for the whole order, left-aligned under "Note:".
  if (order.notes && order.notes.trim()) {
    bodyLines.push(divider());
    bodyLines.push("Note:");
    bodyLines.push(`   ${order.notes.trim()}`);
  }

  bodyLines.push("");           // gap before the totals block
  bodyLines.push(divider());
  bodyLines.push(twoColumn("Subtotal", rm(order.subtotal)));
  if (order.service_charge > 0) bodyLines.push(twoColumn("Service Charge", rm(order.service_charge)));
  if (order.discount_amount > 0) bodyLines.push(twoColumn("Discount", `-${rm(order.discount_amount)}`));
  if (order.sst_amount > 0) {
    // Derive the rate from the amounts so the label stays correct if the
    // backoffice SST rate ever changes (no hardcoded 6%).
    const taxBase = order.total - order.sst_amount;
    const pct = taxBase > 0 ? Math.round((order.sst_amount / taxBase) * 100) : 0;
    bodyLines.push(twoColumn(`SST (${pct}%)`, rm(order.sst_amount)));
  }
  bodyLines.push(divider("="));
  bodyLines.push(twoColumn("TOTAL", rm(order.total)));
  bodyLines.push(divider("="));

  for (const p of payments) {
    const method =
      p.payment_method === "cash" ? "Cash"
      : p.payment_method === "card" ? "Card"
      : p.payment_method === "qr" || p.payment_method === "ewallet" ? "E-Wallet"
      : p.payment_method;
    bodyLines.push(twoColumn(method, rm(p.amount)));
  }

  const footerLines: string[] = [];
  footerLines.push("");
  footerLines.push(centerText(config?.receiptFooter || "Thank you for visiting!"));
  footerLines.push(centerText("www.celsiuscoffee.com"));
  footerLines.push("");

  return {
    header: headerLines.join("\n"),
    body: bodyLines.join("\n"),
    footer: footerLines.join("\n"),
    showLogo: config?.showLogo !== false,
    qrUrl: config?.qrUrl || "",
    qrLabel: config?.qrLabel || "",
    promoText: config?.promoEnabled && config?.promoText ? config.promoText : "",
  };
}

// ─── Kitchen docket ────────────────────────────────────────

export interface DocketData {
  station: string;
  orderNumber: string;
  orderType: string;
  tableNumber: string;
  tableLabel: string;
  queueNumber: string;
  time: string;
  items: string; // newline-separated item lines for the native module
}

export type DocketOrder = {
  order_number: string;
  order_type: string;
  table_number?: string | null;
  table_label?: string;
  queue_number?: string | null;
  created_at: string;
  pos_order_items?: {
    product_name: string;
    variant_name?: string | null;
    quantity: number;
    kitchen_station?: string | null;
    modifiers?: unknown;
    notes?: string | null;
  }[];
};

export function formatKitchenDocket(order: DocketOrder, station: string): DocketData | null {
  const items = (order.pos_order_items ?? []).filter((i) => !station || i.kitchen_station === station);
  if (items.length === 0) return null;

  const date = new Date(order.created_at);
  const stationName = (station || "KITCHEN").toUpperCase();
  const orderType = order.order_type === "dine_in" ? "DINE-IN" : "TAKEAWAY";
  const timeStr = date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true });

  const itemLines: string[] = [];
  for (const item of items) {
    itemLines.push(`${item.quantity}x ${item.product_name}`);
    if (item.variant_name) itemLines.push(`   ${item.variant_name}`);
    const mods = item.modifiers;
    if (Array.isArray(mods) && mods.length > 0) {
      const modNames = mods.map((m: any) => m.option?.name ?? m.name ?? "").filter(Boolean);
      if (modNames.length > 0) itemLines.push(`   ${modNames.join(", ")}`);
    }
    if (item.notes) itemLines.push(`   ** ${item.notes} **`);
    itemLines.push("---");
  }

  return {
    station: stationName,
    orderNumber: order.order_number,
    orderType,
    tableNumber: order.table_number ?? "",
    tableLabel: order.table_label ?? "Table",
    queueNumber: order.queue_number ?? "",
    time: timeStr,
    items: itemLines.join("\n"),
  };
}

/** Distinct kitchen stations present in an order (for docket routing). */
export function stationsForOrder(order: DocketOrder): string[] {
  const set = new Set(
    (order.pos_order_items ?? []).map((i) => i.kitchen_station).filter(Boolean) as string[],
  );
  if (set.size === 0) set.add(""); // no station → one combined "KITCHEN" docket
  return [...set];
}
