"use client";

import { use, useEffect, useState } from "react";

type CodeState =
  | { phase: "loading" }
  | { phase: "form"; outletName: string }
  | { phase: "claimed" }
  | { phase: "invalid" }
  | { phase: "done"; message: string };

export default function RecoverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [state, setState] = useState<CodeState>({ phase: "loading" });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/recovery?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.claimed) setState({ phase: "claimed" });
        else if (d.usable) setState({ phase: "form", outletName: d.outletName ?? "Celsius Coffee" });
        else setState({ phase: "invalid" });
      })
      .catch(() => active && setState({ phase: "invalid" }));
    return () => {
      active = false;
    };
  }, [code]);

  const submit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, phone }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setState({ phase: "done", message: d.message || "Thank you — your voucher is in your account." });
      } else {
        setError(d.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F1EA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-center">
          <p className="font-heading text-2xl font-bold text-[#1A0200]">Celsius Coffee</p>
          <div className="mx-auto mt-3 h-px w-12 bg-[#D2965C]" />
        </div>

        {state.phase === "loading" && (
          <p className="mt-6 text-center text-sm text-neutral-500">Checking your link…</p>
        )}

        {state.phase === "invalid" && (
          <div className="mt-6 text-center">
            <p className="text-base font-semibold text-[#1A0200]">This link isn’t valid</p>
            <p className="mt-2 text-sm text-neutral-500">
              The recovery link may have expired or been mistyped. Please reply to our message on Google and we’ll sort it out.
            </p>
          </div>
        )}

        {state.phase === "claimed" && (
          <div className="mt-6 text-center">
            <p className="text-base font-semibold text-[#1A0200]">You’re all set</p>
            <p className="mt-2 text-sm text-neutral-500">
              You’ve already claimed this — your free coffee is in your account. See you soon.
            </p>
          </div>
        )}

        {state.phase === "done" && (
          <div className="mt-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#1A0200] text-white text-xl">✓</div>
            <p className="mt-3 text-base font-semibold text-[#1A0200]">Thank you</p>
            <p className="mt-2 text-sm text-neutral-600">{state.message}</p>
          </div>
        )}

        {state.phase === "form" && (
          <div className="mt-6">
            <p className="text-center text-sm text-neutral-600">
              We’re sorry your visit to <span className="font-medium text-[#1A0200]">{state.outletName}</span> fell short.
              Leave your number and we’ll put <span className="font-medium text-[#1A0200]">a free coffee</span> in your account to make it right.
            </p>
            <div className="mt-5 space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-[#1A0200]"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="Mobile number (e.g. 0123456789)"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-[#1A0200]"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                onClick={submit}
                disabled={submitting || !phone.trim()}
                className="w-full rounded-lg bg-[#1A0200] py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Claim my free coffee"}
              </button>
              <p className="text-center text-[11px] text-neutral-400">
                By continuing you agree to join Celsius rewards so we can send your voucher.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
