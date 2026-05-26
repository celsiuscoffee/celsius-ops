"use client";

import { useState } from "react";
import { CreditCard, Smartphone, ShoppingBag, Landmark, type LucideIcon } from "lucide-react";
import type { CartItem } from "@/types/database";
import { displayRM } from "@/types/database";

type PaymentMethod = { id: string; label: string; Icon: LucideIcon };

const METHODS: PaymentMethod[] = [
  { id: "ghl_terminal", label: "Card (Terminal)", Icon: CreditCard },
  { id: "tng",          label: "Touch 'n Go",     Icon: Smartphone },
  { id: "grabpay",      label: "GrabPay",         Icon: ShoppingBag },
  { id: "fpx",          label: "FPX",             Icon: Landmark },
];

type Split = { method: string; amount: number; status: "pending" | "paid" };

type Props = {
  total: number;
  onComplete: (splits: Split[]) => void;
  onClose: () => void;
};

export function SplitBillModal({ total, onComplete, onClose }: Props) {
  const [splits, setSplits] = useState<Split[]>([]);
  const [splitAmount, setSplitAmount] = useState("");
  const [step, setStep] = useState<"amount" | "method" | "done">("amount");

  const paidTotal = splits.reduce((s, sp) => s + sp.amount, 0);
  const remaining = total - paidTotal;

  function handleSetAmount() {
    const amt = Math.round(parseFloat(splitAmount) * 100);
    if (isNaN(amt) || amt <= 0 || amt > remaining) return;
    setStep("method");
  }

  function handleSelectMethod(methodId: string) {
    const amt = Math.round(parseFloat(splitAmount) * 100);
    const newSplit: Split = { method: methodId, amount: amt, status: "paid" };
    const updated = [...splits, newSplit];
    setSplits(updated);
    setSplitAmount("");

    const newRemaining = total - updated.reduce((s, sp) => s + sp.amount, 0);
    if (newRemaining <= 0) {
      setStep("done");
    } else {
      setStep("amount");
    }
  }

  function handlePayRemaining(methodId: string) {
    const newSplit: Split = { method: methodId, amount: remaining, status: "paid" };
    setSplits((prev) => [...prev, newSplit]);
    setStep("done");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-2xl bg-surface-raised shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold">Split Bill</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-hover">&times;</button>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3">
          <div className="flex justify-between text-xs">
            <span className="text-text-muted">Paid: {displayRM(paidTotal)}</span>
            <span className="font-medium">Remaining: {displayRM(remaining)}</span>
          </div>
          <div className="mt-1.5 h-2 w-full rounded-full bg-surface">
            <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${(paidTotal / total) * 100}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-text-dim">Total: {displayRM(total)}</p>
        </div>

        {/* Paid splits */}
        {splits.length > 0 && (
          <div className="border-t border-border px-5 py-2">
            {splits.map((sp, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-success">✓</span>
                  <span>{METHODS.find((m) => m.id === sp.method)?.label ?? sp.method}</span>
                </div>
                <span className="font-medium">{displayRM(sp.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-4">
          {step === "amount" && (
            <div>
              <p className="mb-2 text-sm text-text-muted">Enter amount for this split:</p>
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0.01" max={(remaining / 100).toFixed(2)} value={splitAmount}
                  onChange={(e) => setSplitAmount(e.target.value)}
                  className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                  placeholder={`Max: ${(remaining / 100).toFixed(2)}`} autoFocus />
                <button onClick={() => setSplitAmount((remaining / 100).toFixed(2))}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface-hover">Remaining</button>
              </div>
              <div className="mt-3 flex gap-2">
                {[0.25, 0.5].map((frac) => (
                  <button key={frac} onClick={() => setSplitAmount(((remaining * frac) / 100).toFixed(2))}
                    className="flex-1 rounded-lg border border-border py-2 text-xs font-medium hover:bg-surface-hover">
                    {frac === 0.5 ? "Half" : "Quarter"}
                  </button>
                ))}
                <button onClick={() => {
                  const perPerson = remaining / 2;
                  setSplitAmount((perPerson / 100).toFixed(2));
                }} className="flex-1 rounded-lg border border-border py-2 text-xs font-medium hover:bg-surface-hover">Split 2</button>
                <button onClick={() => {
                  const perPerson = remaining / 3;
                  setSplitAmount((perPerson / 100).toFixed(2));
                }} className="flex-1 rounded-lg border border-border py-2 text-xs font-medium hover:bg-surface-hover">Split 3</button>
              </div>
              <button onClick={handleSetAmount} disabled={!splitAmount || parseFloat(splitAmount) <= 0}
                className="mt-3 w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                Continue to Payment
              </button>
            </div>
          )}

          {step === "method" && (
            <div>
              <p className="mb-2 text-sm text-text-muted">
                Pay {displayRM(Math.round(parseFloat(splitAmount) * 100))} with:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button key={m.id} onClick={() => handleSelectMethod(m.id)}
                    className="flex items-center gap-2 rounded-xl border border-border p-3 text-left transition-all hover:border-brand active:scale-[0.98]">
                    <m.Icon className="h-5 w-5 text-brand" strokeWidth={1.8} />
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep("amount")} className="mt-3 w-full text-xs text-text-muted hover:underline">Back</button>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-4">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-semibold">All Splits Paid</p>
              <button onClick={() => onComplete(splits)} className="mt-4 rounded-xl bg-brand px-8 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
                Complete Order
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
