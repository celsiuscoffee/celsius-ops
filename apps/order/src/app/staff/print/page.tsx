"use client";

/**
 * /staff/print?id=ORDER_ID&type=kitchen|receipt
 *
 * Opens the receipt as a standalone page for printing.
 * Works on Sunmi V3 Chrome PWA where window.print() fails in standalone mode.
 *
 * Flow: opens in-app → auto-triggers print → user taps back to return to KDS.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  "conezion": "Putrajaya",
  "tamarind": "Tamarind Square",
  "putrajaya": "Celsius Coffee Putrajaya",
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

export default function PrintPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("id");
  const type = searchParams.get("type") || "kitchen"; // kitchen | receipt
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    // Service-role-backed endpoint; anon SELECT on orders was revoked
    // by security lockdown A3, so direct Supabase reads 401 here.
    fetch(`/api/orders/${orderId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: OrderWithItems | null) => {
        if (data) setOrder(data);
      })
      .catch(() => { /* leaves "Loading..." in place; user can retry */ });
  }, [orderId]);

  // Auto-print when order loads (only on desktop — RawBT handles Android)
  useEffect(() => {
    if (!order || printed) return;
    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) return; // RawBT renders and prints this page itself
    const timer = setTimeout(() => {
      window.print();
      setPrinted(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [order, printed]);

  if (!order) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
        Loading...
      </div>
    );
  }

  const store = storeName(order.store_id);

  if (type === "receipt") {
    return (
      <>
        <style>{printStyles}</style>
        <div className="print-body">
          <div className="receipt-content">
            <div className="center brand">Celsius Coffee</div>
            <div className="center store">{store}</div>
            <div className="center" style={{ fontSize: 10, marginTop: 2 }}>
              {dateStr(order.created_at)} &bull; {timeStr(order.created_at)}
            </div>
            <div className="dash" />
            <div className="center">
              <div className="label">Order</div>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.1 }}>
                #{order.order_number}
              </div>
            </div>
            <div className="dash" />
            <div style={{ marginBottom: 4 }}>
              {order.order_items.map((item) => {
                const mods = (item.modifiers?.selections ?? []).map((s) => s.label).join(", ");
                return (
                  <div key={item.id} className="item">
                    <div className="row">
                      <span className="bold">{item.quantity}&times; {item.product_name}</span>
                      <span>{fmt(item.unit_price * item.quantity)}</span>
                    </div>
                    {mods && <div className="mods">{mods}</div>}
                    {item.modifiers?.specialInstructions && (
                      <div className="note">&#10033; {item.modifiers.specialInstructions}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="dash" />
            <div className="row"><span>Subtotal</span><span>{fmt(order.subtotal)}</span></div>
            {order.discount_amount > 0 && (
              <div className="row"><span>Voucher ({order.voucher_code ?? ""})</span><span>- {fmt(order.discount_amount)}</span></div>
            )}
            {order.reward_discount_amount > 0 && (
              <div className="row"><span>Reward</span><span>- {fmt(order.reward_discount_amount)}</span></div>
            )}
            {order.sst_amount > 0 && (
              <div className="row"><span>SST (6%)</span><span>{fmt(order.sst_amount)}</span></div>
            )}
            <div className="dash" />
            <div className="row total"><span>TOTAL</span><span>{fmt(order.total)}</span></div>
            <div style={{ marginTop: 4, fontSize: 10 }}>
              Payment: {(order.payment_method ?? "").toUpperCase().replace(/_/g, " ")}
            </div>
            <div className="dash" />
            <div className="footer-text">Thank you for choosing Celsius Coffee!</div>
          </div>
          <button className="no-print back-btn" onClick={() => window.history.back()}>
            &larr; Back to Orders
          </button>
          <button className="no-print print-btn" onClick={() => window.print()}>
            Print Again
          </button>
        </div>
      </>
    );
  }

  // Kitchen slip (default)
  return (
    <>
      <style>{printStyles}</style>
      <div className="print-body">
        <div className="receipt-content">
          <div className="slip-label">KITCHEN ORDER</div>
          <div className="center brand">Celsius Coffee</div>
          <div className="center store">{store}</div>
          <div className="dash" />
          <div className="order-num">#{order.order_number}</div>
          <div className="center label">
            {timeStr(order.created_at)} &bull; {dateStr(order.created_at)}
          </div>
          <div className="dash" />
          <div style={{ marginBottom: 6 }}>
            {order.order_items.map((item) => {
              const mods = (item.modifiers?.selections ?? []).map((s) => s.label).join(", ");
              return (
                <div key={item.id} className="item">
                  <div className="item-name">{item.quantity}&times; {item.product_name}</div>
                  {mods && <div className="mods">{mods}</div>}
                  {item.modifiers?.specialInstructions && (
                    <div className="note">&#10033; {item.modifiers.specialInstructions}</div>
                  )}
                </div>
              );
            })}
          </div>
          {order.notes && (
            <div style={{ border: "2px solid #000", borderRadius: 2, padding: "4px 6px", margin: "4px 0" }}>
              <div style={{ fontSize: 10, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>
                &#9998; Order Note
              </div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{order.notes}</div>
            </div>
          )}
          <div className="dash" />
          <div className="footer-text">SELF-PICKUP &bull; CELSIUS COFFEE</div>
        </div>
        <button className="no-print back-btn" onClick={() => window.history.back()}>
          &larr; Back to Orders
        </button>
        <button className="no-print print-btn" onClick={() => window.print()}>
          Print Again
        </button>
      </div>
    </>
  );
}

const printStyles = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .print-body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    width: 80mm;
    max-width: 100vw;
    margin: 0 auto;
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
  .item { margin-bottom: 7px; }
  .item-name { font-size: 13px; font-weight: bold; }
  .mods { font-size: 11px; padding-left: 10px; color: #333; }
  .note { font-size: 11px; padding-left: 10px; font-style: italic; }
  .row  { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px; }
  .row.total { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .footer-text { font-size: 10px; text-align: center; margin-top: 6px; }
  .back-btn {
    display: block;
    width: 100%;
    margin-top: 20px;
    padding: 12px;
    font-size: 14px;
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 8px;
    cursor: pointer;
  }
  .print-btn {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 12px;
    font-size: 14px;
    font-weight: bold;
    background: #160800;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  @media print {
    .no-print { display: none !important; }
    .print-body { padding: 2mm 4mm; }
  }
`;
