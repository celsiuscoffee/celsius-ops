/**
 * Thermal print utility — Sunmi V3 (80mm) compatible.
 *
 * Uses window.print() with @page { size: 80mm auto } which routes to the
 * Sunmi built-in thermal printer when the page is loaded inside the Sunmi
 * browser, and to any connected printer on desktop.
 *
 * Two print types:
 *  - printKitchenSlip  → large order number, items only, for barista/kitchen
 *  - printReceipt      → full breakdown with prices, for customer
 */

import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  "conezion":  "Conezion",
  "tamarind":  "Tamarind Square",
};

function storeName(storeId: string) {
  return STORE_NAMES[storeId] ?? storeId.replace(/-/g, " ");
}

function fmt(sen: number) {
  return `RM ${(sen / 100).toFixed(2)}`;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function itemsHtml(items: OrderItemRow[]) {
  return items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s) => s.label).join(", ");
    const note = item.modifiers?.specialInstructions;
    return `
      <div class="item">
        <div class="item-name">${item.quantity}&times; ${item.product_name}</div>
        ${mods ? `<div class="mods">${mods}</div>` : ""}
        ${note ? `<div class="note">&#10033; ${note}</div>` : ""}
      </div>`;
  }).join("");
}

function openPrintWindow(html: string) {
  const win = window.open("", "_blank", "width=420,height=700,toolbar=0,menubar=0");
  if (!win) {
    // Popup blocked — inject into current page as hidden iframe
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    iframe.contentDocument?.write(html);
    iframe.contentDocument?.close();
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Small delay so fonts render before print dialog
  setTimeout(() => {
    win.print();
    win.close();
  }, 250);
}

const BASE_STYLES = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    width: 80mm;
    padding: 4mm 5mm;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .bold   { font-weight: bold; }
  .dash   { border-top: 1px dashed #000; margin: 5px 0; }
  .brand  { font-size: 15px; font-weight: bold; letter-spacing: 1px; }
  .store  { font-size: 11px; }
  .label  { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
  .order-num {
    font-size: 56px;
    font-weight: 900;
    text-align: center;
    line-height: 1;
    margin: 6px 0;
    letter-spacing: -2px;
  }
  .item { margin-bottom: 7px; }
  .item-name { font-size: 13px; font-weight: bold; }
  .mods { font-size: 11px; padding-left: 10px; color: #333; }
  .note { font-size: 11px; padding-left: 10px; font-style: italic; }
  .row  { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px; }
  .row.total { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .footer-text { font-size: 10px; text-align: center; margin-top: 6px; }
  @media print {
    body { padding: 2mm 4mm; }
  }
`;

/** Kitchen Order Slip — printed immediately when order arrives. Staff use this to prepare. */
export function printKitchenSlip(order: OrderWithItems) {
  const store = storeName(order.store_id);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>KDS Print</title>
    <style>
      ${BASE_STYLES}
      .slip-label {
        background: #000;
        color: #fff;
        text-align: center;
        font-size: 11px;
        font-weight: bold;
        padding: 2px 0;
        letter-spacing: 2px;
        margin-bottom: 6px;
      }
    </style>
  </head><body>
    <div class="slip-label">KITCHEN ORDER</div>
    <div class="center">
      <div class="brand">Celsius Coffee</div>
      <div class="store">${store}</div>
    </div>
    <div class="dash"></div>
    <div class="order-num">#${order.order_number}</div>
    <div class="center label">${timeStr(order.created_at)} &bull; ${dateStr(order.created_at)}</div>
    <div class="dash"></div>
    <div style="margin-bottom:6px">${itemsHtml(order.order_items)}</div>
    ${order.notes ? `<div style="border:2px solid #000;border-radius:2px;padding:4px 6px;margin:4px 0">
      <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">&#9998; Order Note</div>
      <div style="font-size:12px;margin-top:2px">${order.notes}</div>
    </div>` : ""}
    <div class="dash"></div>
    <div class="footer-text">SELF-PICKUP &bull; CELSIUS COFFEE</div>
    <div style="height:8mm"></div>
  </body></html>`;
  openPrintWindow(html);
}

/** Customer Receipt — printed when order is collected or on demand. */
export function printReceipt(order: OrderWithItems) {
  const store = storeName(order.store_id);
  const payLabel = (order.payment_method ?? "").toUpperCase().replace(/_/g, " ");

  const itemRows = order.order_items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s) => s.label).join(", ");
    const note = item.modifiers?.specialInstructions;
    const total = fmt(item.unit_price * item.quantity);
    return `
      <div class="item">
        <div class="row">
          <span class="bold">${item.quantity}&times; ${item.product_name}</span>
          <span>${total}</span>
        </div>
        ${mods ? `<div class="mods">${mods}</div>` : ""}
        ${note ? `<div class="note">&#10033; ${note}</div>` : ""}
      </div>`;
  }).join("");

  const discountRow = order.discount_amount > 0
    ? `<div class="row"><span>Voucher (${order.voucher_code ?? ""})</span><span>- ${fmt(order.discount_amount)}</span></div>` : "";
  const rewardRow = order.reward_discount_amount > 0
    ? `<div class="row"><span>Reward (${order.reward_name ?? ""})</span><span>- ${fmt(order.reward_discount_amount)}</span></div>` : "";
  const sstRow = order.sst_amount > 0
    ? `<div class="row"><span>SST (6%)</span><span>${fmt(order.sst_amount)}</span></div>` : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Receipt</title>
    <style>${BASE_STYLES}</style>
  </head><body>
    <div class="center">
      <div class="brand">Celsius Coffee</div>
      <div class="store">${store}</div>
      <div style="font-size:10px;margin-top:2px">${dateStr(order.created_at)} &bull; ${timeStr(order.created_at)}</div>
    </div>
    <div class="dash"></div>
    <div class="center">
      <div class="label">Order</div>
      <div style="font-size:32px;font-weight:900;line-height:1.1">#${order.order_number}</div>
    </div>
    <div class="dash"></div>
    <div style="margin-bottom:4px">${itemRows}</div>
    <div class="dash"></div>
    <div class="row"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
    ${discountRow}
    ${rewardRow}
    ${sstRow}
    <div class="dash"></div>
    <div class="row total"><span>TOTAL</span><span>${fmt(order.total)}</span></div>
    <div style="margin-top:4px;font-size:10px">Payment: ${payLabel}</div>
    ${order.notes ? `<div style="margin-top:4px;font-size:10px;font-style:italic">Note: ${order.notes}</div>` : ""}
    <div class="dash"></div>
    <div class="footer-text">Thank you for choosing Celsius Coffee!</div>
    <div class="footer-text">Self-pickup &bull; ${store}</div>
    <div style="height:8mm"></div>
  </body></html>`;
  openPrintWindow(html);
}
