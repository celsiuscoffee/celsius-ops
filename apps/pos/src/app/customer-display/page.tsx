"use client";

import { formatRM } from "@celsius/shared";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { listenToCustomerDisplay, type CustomerDisplayData } from "@/lib/customer-display-channel";

/**
 * Maybank DuitNow QR merchant IDs per outlet.
 * These generate a static "pay to merchant" QR — amount is shown on screen.
 */
const MAYBANK_MERCHANT_IDS: Record<string, string> = {
  "outlet-sa":  "MBBQR1671618",
  "outlet-con": "MBBQR2449289",
  "outlet-tam": "MBBQR2430878",
};

// Wrapper around the shared formatRM that converts sen → RM up front.
const formatSen = (sen: number) => formatRM(sen / 100);

export default function CustomerDisplayPage() {
  const [data, setData] = useState<CustomerDisplayData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Listen for broadcasts from the register
  useEffect(() => {
    return listenToCustomerDisplay(setData);
  }, []);

  // Render Maybank QR code
  const merchantId = data ? MAYBANK_MERCHANT_IDS[data.outletId] : null;

  useEffect(() => {
    if (!canvasRef.current || !merchantId) return;
    // DuitNow QR payload is just the merchant ID for static QR
    QRCode.toCanvas(canvasRef.current, merchantId, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }, [merchantId]);

  // Idle / Welcome screen
  if (!data || data.status === "idle" || data.items.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <img src="/images/celsius-logo-sm.jpg" alt="Celsius" className="mb-6 h-24 w-24 rounded-2xl" />
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Celsius Coffee</h1>
        <p className="mt-2 text-lg text-gray-400">Freshly roasted, always bold</p>
      </div>
    );
  }

  // Order complete screen
  if (data.status === "complete") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h1 className="text-3xl font-bold">Thank You!</h1>
        {data.orderNumber && <p className="mt-2 text-xl text-gray-400">Order #{data.orderNumber}</p>}
        <p className="mt-4 text-lg text-gray-500">Your order is being prepared</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* LEFT — Order summary */}
      <div className="flex flex-1 flex-col p-8">
        <div className="mb-4 flex items-center gap-3">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius" className="h-10 w-10 rounded-xl" />
          <div>
            <h2 className="text-lg font-bold">{data.outletName}</h2>
            <p className="text-xs text-gray-500">Your Order</p>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {data.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between border-b border-gray-800 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  <span className="mr-2 text-gray-500">{item.qty}x</span>
                  {item.name}
                </p>
                {item.modifiers && (
                  <p className="mt-0.5 text-xs text-gray-500">{item.modifiers}</p>
                )}
              </div>
              <p className="ml-4 text-sm font-medium text-gray-300">{formatSen(item.amount)}</p>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 space-y-2 border-t border-gray-700 pt-4">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Subtotal</span>
            <span>{formatSen(data.subtotal)}</span>
          </div>
          {data.serviceCharge > 0 && (
            <div className="flex justify-between text-sm text-gray-400">
              <span>Service Charge</span>
              <span>{formatSen(data.serviceCharge)}</span>
            </div>
          )}
          {data.discount > 0 && (
            <div className="flex justify-between text-sm text-green-400">
              <span>Discount</span>
              <span>-{formatSen(data.discount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-700 pt-3 text-2xl font-bold">
            <span>Total</span>
            <span className="text-amber-400">{formatSen(data.total)}</span>
          </div>
        </div>
      </div>

      {/* RIGHT — QR Payment */}
      <div className="flex w-[380px] flex-col items-center justify-center border-l border-gray-800 bg-gray-900 p-8">
        <p className="mb-2 text-sm font-medium text-gray-400">Scan to Pay</p>
        <div className="rounded-2xl bg-white p-4">
          <canvas ref={canvasRef} className="h-[280px] w-[280px]" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="h-6 w-auto">
            <svg viewBox="0 0 120 30" className="h-6 text-yellow-500" fill="currentColor">
              <text x="0" y="22" fontSize="18" fontWeight="bold" fontFamily="Arial">Maybank</text>
            </svg>
          </div>
          <span className="text-xs text-gray-500">DuitNow QR</span>
        </div>
        {merchantId && (
          <p className="mt-2 text-[10px] text-gray-600">{merchantId}</p>
        )}
        <div className="mt-6 text-center">
          <p className="text-3xl font-bold text-amber-400">{formatSen(data.total)}</p>
          <p className="mt-1 text-xs text-gray-500">Amount to pay</p>
        </div>
      </div>
    </div>
  );
}
