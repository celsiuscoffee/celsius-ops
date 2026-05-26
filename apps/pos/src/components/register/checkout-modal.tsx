"use client";

import { useState } from "react";
import type { CartItem, OrderType } from "@/types/database";
import { displayRM } from "@/types/database";
// QRPaymentModal kept for future standalone QR flow
// import { QRPaymentModal } from "@/components/pos/qr-payment-modal";

import { QrCode, CreditCard, type LucideIcon } from "lucide-react";

type PaymentMethod = {
  id: string;
  label: string;
  Icon: LucideIcon;
  provider: string;
};

const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "qr_pay",        label: "DuitNow QR",      Icon: QrCode,     provider: "revenue_monster" },
  { id: "card_terminal", label: "Card (Terminal)", Icon: CreditCard, provider: "revenue_monster" },
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

  function handleSelectMethod(methodId: string) {
    handleTerminalPay(methodId);
  }

  async function handleTerminalPay(methodId: string) {
    setSelectedMethod(methodId);
    setStep("processing");
    setError("");

    // Free order shortcut — when the cart is fully comped by voucher +
    // tier discount, total is RM 0 and there's nothing to charge.
    // Skip the terminal entirely and complete as Complimentary so the
    // cashier doesn't sit through a pointless "Payment Failed" loop.
    if (total <= 0) {
      setStep("success");
      setTimeout(() => {
        onComplete(orderNumber, queueNumber, "Complimentary");
      }, 800);
      return;
    }

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

      // Show success for 2 seconds then complete
      setTimeout(() => {
        onComplete(orderNumber, queueNumber, methodLabel);
      }, 2000);
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

            <div className="px-5 py-5">
              {total <= 0 ? (
                // Free order — discounts already cover the bill. No
                // need to ask for a payment method; one big button to
                // confirm and complete.
                <>
                  <p className="mb-3 text-base font-medium text-success">
                    Nothing to charge — discounts cover the order
                  </p>
                  <button
                    onClick={() => handleSelectMethod("free")}
                    className="w-full rounded-xl bg-brand py-4 text-base font-semibold text-white transition hover:bg-brand-dark active:scale-[0.98]"
                  >
                    Complete (Complimentary)
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-3 text-base font-medium text-text-muted">Select payment method</p>
                  <div className="grid grid-cols-2 gap-4">
                    {PAYMENT_METHODS.map((method) => (
                      <button
                        key={method.id}
                        onClick={() => handleSelectMethod(method.id)}
                        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border p-6 transition-all hover:border-brand hover:shadow-sm active:scale-[0.98]"
                      >
                        <method.Icon className="h-10 w-10 text-brand" strokeWidth={1.8} />
                        <span className="text-base font-semibold">{method.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
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
