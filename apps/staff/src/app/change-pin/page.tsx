"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

const PIN_LENGTH = 6;

/**
 * Forced PIN change.
 *
 * Reached when `mustChangePin` is set — the PIN in use was chosen by someone
 * else (HR issued it from the employee's IC, or a manager reset it). The
 * middleware refuses every other page and every /api/* call until it is
 * replaced, so this screen deliberately has no way out: no back button, no
 * skip, no navigation chrome.
 */
export default function ChangePinPage() {
  const [current, setCurrent] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [next, setNext] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [confirm, setConfirm] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const currentRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nextRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { setTimeout(() => currentRefs.current[0]?.focus(), 100); }, []);

  const join = (a: string[]) => a.join("");

  const handleChange = (
    raw: string,
    index: number,
    value: string[],
    setValue: (v: string[]) => void,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
  ) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > 1) {
      const nextValue = [...value];
      for (let i = 0; i < digits.length && index + i < PIN_LENGTH; i++) {
        nextValue[index + i] = digits[i];
      }
      setValue(nextValue);
      refs.current[Math.min(index + digits.length, PIN_LENGTH - 1)]?.focus();
      return;
    }
    const nextValue = [...value];
    nextValue[index] = digits;
    setValue(nextValue);
    if (digits && index < PIN_LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    value: string[],
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
  ) => {
    if (e.key === "Backspace" && !value[index] && index > 0) refs.current[index - 1]?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const currentPin = join(current);
    const newPin = join(next);
    const confirmPin = join(confirm);

    if (newPin.length !== PIN_LENGTH) return setError("Your new PIN must be 6 digits.");
    if (newPin !== confirmPin) return setError("The two new PINs don't match.");
    if (newPin === currentPin) return setError("Choose a PIN different from the one you were given.");

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not change your PIN.");
        return;
      }
      // Full reload: the session cookie was re-issued without the flag, and a
      // client-side route change would keep the old one in memory.
      window.location.href = "/";
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const boxes = (
    value: string[],
    setValue: (v: string[]) => void,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    label: string,
    autoComplete: string,
  ) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        {value.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="password"
            inputMode="numeric"
            autoComplete={autoComplete}
            maxLength={PIN_LENGTH}
            value={digit}
            onChange={(e) => handleChange(e.target.value, i, value, setValue, refs)}
            onKeyDown={(e) => handleKeyDown(e, i, value, refs)}
            className="h-12 w-full rounded-xl border border-gray-300 bg-white text-center text-xl font-bold focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/30"
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10">
            <ShieldCheck className="h-6 w-6 text-terracotta" />
          </div>
          <h1 className="text-xl font-bold">Set your own PIN</h1>
          <p className="mt-1 text-sm text-gray-500">
            The PIN you were given is temporary and other people know it. Choose
            one only you know before you carry on.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          {boxes(current, setCurrent, currentRefs, "PIN you were given", "current-password")}
          {boxes(next, setNext, nextRefs, "New PIN", "new-password")}
          {boxes(confirm, setConfirm, confirmRefs, "Confirm new PIN", "new-password")}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-terracotta py-3 font-semibold text-white active:scale-95 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save new PIN
          </button>

          <p className="text-center text-xs text-gray-400">
            Don&apos;t reuse your date of birth — that is what the temporary PIN was.
          </p>
        </form>
      </div>
    </div>
  );
}
