"use client";

import { useState } from "react";
import type { CartItem, OrderType } from "@/types/database";
import { displayRM } from "@/types/database";
// QRPaymentModal kept for future standalone QR flow
// import { QRPaymentModal } from "@/components/pos/qr-payment-modal";

type PaymentMethod = {
  id: string;
  label: string;
  icon: string;
  provider: string;
};

const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "qr_pay", label: "DuitNow QR", icon: "📲", provider: "revenue_monster" },
  { id: "ewallet", label: "E-Wallet", icon: "📱", provider: "revenue_monster" },
  { id: "card_terminal", label: "Card (Terminal)", icon: "💳", provider: "revenue_monster" },
  { id: "grabpay", label: "GrabPay", icon: "🟢", provider: "revenue_monster" },
  { id: "tng", label: "Touch 'n Go", icon: "📱", provider: "revenue_monster" },
  { id: "fpx", label: "FPX", icon: "🏦", provider: "revenue_monster" },
];

// Map checkout method IDs to Revenue Monster terminal payment types
const RM_TYPE_MAP: Record<string, string> = {
  qr_pay: "RETAIL-QR",
  ewallet: "E-WALLET",
  card_terminal: "CARD",
  grabpay: "E-WALLET",
  tng: "E-WALLET",
  fpx: "E-WALLET",
};

type CheckoutStep = "method" | "processing" | "success" | "failed";

type Props = {
  items: CartItem[];
  orderType: OrderType;
  subtotal: number;
  serviceCharge: number;
  discount: number;
  total: number;
  queueNumber?: string;
  orderNumber: string;
  onComplete: (orderNumber: string, queueNumber: string, paymentMethod: string) => void;
  onClose: () => void;
};

export function CheckoutModal({
  items,
  orderType,
  subtotal,
  serviceCharge,
  discount,
  total,
  queueNumber: initialQueueNumber,
  orderNumber: initialOrderNumber,
  onComplete,
  onClose,
}: Props) {
  const [step, setStep] = useState<CheckoutStep>("method");
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [orderNumber] = useState(initialOrderNumber);
  const [queueNumber] = useState(initialQueueNumber ?? "");
  const [error, setError] = useState("");

  async function handlePay(methodId: string) {
    setSelectedMethod(methodId);
    setStep("processing");
    setError("");

    try {
      const rmType = RM_TYPE_MAP[methodId] || "E-WALLET";
      const methodLabel = PAYMENT_METHODS.find((m) => m.id === methodId)?.label ?? methodId;
      const orderId = orderNumber || `POS-${Date.now()}`;

      const res = await fetch("/api/payment/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          orderTitle: `Celsius ${orderType === "dine_in" ? "Dine-in" : "Takeaway"}`,
          amount: total, // already in sen
          type: rmType,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Payment failed");
      }

      setStep("success");

      // Small delay then complete
      setTimeout(() => {
        onComplete(orderNumber, queueNumber, methodLabel);
      }, 100);
    } catch (err) {
      setStep("failed");
      setError(err instanceof Error ? err.message : "Payment failed. Please try again.");
    }
  }

  function handleRetry() {
    setStep("method");
    setSelectedMethod(null);
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-2xl bg-surface-raised shadow-2xl">
        {/* Method Selection */}
        {step === "method" && (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <img src="/images/celsius-logo-sm.jpg" alt="Celsius" width={36} height={36} className="rounded-lg" />
                <div>
                  <h3 className="text-lg font-semibold">Payment</h3>
                  <p className="text-sm text-text-muted">
                    {orderType === "dine_in" ? "Dine-in" : "Takeaway"} &middot;{" "}
                    {items.length} item{items.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-hover">
                &times;
              </button>
            </div>

            {/* Item breakdown */}
            <div className="max-h-32 overflow-y-auto border-b border-border px-5 py-2">
              {items.map((item, i) => (
                <div key={i} className="flex justify-between py-0.5 text-xs">
                  <span className="text-text-muted truncate mr-2">
                    {item.quantity > 1 && <span className="text-text">{item.quantity}x </span>}
                    {item.product.name}
                    {item.selectedModifiers.length > 0 && (
                      <span className="text-text-dim"> ({item.selectedModifiers.map((m: any) => m.option.name).join(", ")})</span>
                    )}
                  </span>
                  <span className="whitespace-nowrap">{displayRM(item.lineTotal)}</span>
                </div>
              ))}
            </div>

            <div className="border-b border-border px-5 py-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Subtotal</span>
                  <span>{displayRM(subtotal)}</span>
                </div>
                {serviceCharge > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Service Charge</span>
                    <span>{displayRM(serviceCharge)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Discount</span>
                    <span className="text-success">-{displayRM(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-base font-bold">
                  <span>Total</span>
                  <span>{displayRM(total)}</span>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="mb-3 text-sm font-medium text-text-muted">Select payment method</p>
              <div className="grid grid-cols-2 gap-3">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.id}
                    onClick={() => handlePay(method.id)}
                    className="flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-all hover:border-brand hover:shadow-sm active:scale-[0.98]"
                  >
                    <span className="text-2xl">{method.icon}</span>
                    <span className="text-sm font-medium">{method.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Processing */}
        {step === "processing" && (
          <div className="flex flex-col items-center justify-center px-5 py-16">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand border-t-transparent" />
            <h3 className="text-lg font-semibold">Processing Payment</h3>
            <p className="mt-1 text-sm text-text-muted">
              Waiting for {PAYMENT_METHODS.find((m) => m.id === selectedMethod)?.label ?? "payment"}...
            </p>
            <p className="mt-4 text-xs text-text-dim">Do not close this window</p>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="flex flex-col items-center justify-center px-5 py-12">
            <div className="relative mb-4">
              {/* Pulse rings */}
              <div className="absolute inset-0 animate-ping rounded-full bg-success/20" style={{ animationDuration: "1.5s" }} />
              <div className="absolute -inset-2 animate-ping rounded-full bg-success/10" style={{ animationDuration: "2s", animationDelay: "0.3s" }} />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
                <svg className="h-8 w-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-bold">Payment Successful</h3>
            <p className="mt-1 text-sm text-text-muted">{displayRM(total)}</p>
            {queueNumber && (
              <div className="mt-6 rounded-xl bg-surface px-8 py-4 text-center">
                <p className="text-xs text-text-muted">Queue Number</p>
                <p className="text-3xl font-bold text-brand">{queueNumber}</p>
                <p className="mt-1 text-xs text-text-dim">Order {orderNumber}</p>
              </div>
            )}
          </div>
        )}

        {/* Failed */}
        {step === "failed" && (
          <div className="flex flex-col items-center justify-center px-5 py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
              <svg className="h-8 w-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-xl font-bold">Payment Failed</h3>
            <p className="mt-1 text-sm text-text-muted">{error}</p>
            <div className="mt-6 flex gap-3">
              <button onClick={handleRetry} className="rounded-xl bg-brand px-8 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
                Retry Payment
              </button>
              <button onClick={handleRetry} className="rounded-xl border border-border px-6 py-3 text-sm font-medium hover:bg-surface-hover">
                Try Different Method
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
