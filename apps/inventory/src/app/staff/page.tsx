"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const pinLength = 6;
  const [pin, setPin] = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setTimeout(() => pinRefs.current[0]?.focus(), 100);
  }, []);

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, pinLength);
      const newPin = [...pin];
      for (let i = 0; i < digits.length && index + i < pinLength; i++) newPin[index + i] = digits[i];
      setPin(newPin);
      pinRefs.current[Math.min(index + digits.length, pinLength - 1)]?.focus();
      if (newPin.every((d) => d !== "")) submitPin(newPin.join(""));
      return;
    }
    const digit = value.replace(/\D/g, "");
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    if (digit && index < pinLength - 1) pinRefs.current[index + 1]?.focus();
    if (digit && index === pinLength - 1 && newPin.every((d) => d !== "")) submitPin(newPin.join(""));
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) pinRefs.current[index - 1]?.focus();
  };

  const submitPin = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid PIN");
        setPin(Array(pinLength).fill(""));
        pinRefs.current[0]?.focus();
        return;
      }
      window.location.href = "/home";
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={56} height={56} className="mx-auto rounded-xl" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Celsius Inventory</h1>
          <p className="mt-1 text-sm text-white/50">Staff Login</p>
          <p className="mt-1 text-xs text-white/30">Enter your {pinLength}-digit PIN</p>
        </div>

        <div className="space-y-4">
          <div className="flex justify-center gap-3">
            {pin.map((digit, i) => (
              <input key={i} ref={(el) => { pinRefs.current[i] = el; }} type="password" inputMode="numeric" maxLength={pinLength} value={digit}
                onChange={(e) => handlePinChange(i, e.target.value)} onKeyDown={(e) => handlePinKeyDown(i, e)}
                className="h-14 w-14 rounded-xl border border-white/10 bg-white/5 text-center text-2xl font-bold text-white outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta" />
            ))}
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-xs text-red-400">{error}</p>}
          {loading && <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/50" /></div>}
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          Contact admin if you don&apos;t have a PIN
        </p>
      </div>
    </div>
  );
}
