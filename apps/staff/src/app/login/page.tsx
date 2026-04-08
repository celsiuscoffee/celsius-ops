"use client";

import { useState, useRef, useEffect } from "react";
/* eslint-disable @next/next/no-img-element */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft } from "lucide-react";

type LoginMode = "choose" | "username" | "pin";

const PIN_LENGTH = 6;

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("choose");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (mode === "pin") setTimeout(() => pinRefs.current[0]?.focus(), 100);
  }, [mode]);

  const handleUsernameLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); return; }
      window.location.href = "/checklists";
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
      const newPin = [...pin];
      for (let i = 0; i < digits.length && index + i < PIN_LENGTH; i++) newPin[index + i] = digits[i];
      setPin(newPin);
      pinRefs.current[Math.min(index + digits.length, PIN_LENGTH - 1)]?.focus();
      if (newPin.every((d) => d !== "")) submitPin(newPin.join(""));
      return;
    }
    const digit = value.replace(/\D/g, "");
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    if (digit && index < PIN_LENGTH - 1) pinRefs.current[index + 1]?.focus();
    if (digit && index === PIN_LENGTH - 1 && newPin.every((d) => d !== "")) submitPin(newPin.join(""));
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
        setPin(Array(PIN_LENGTH).fill(""));
        pinRefs.current[0]?.focus();
        return;
      }
      window.location.href = "/checklists";
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  const goBack = () => {
    setMode("choose");
    setPin(Array(PIN_LENGTH).fill(""));
    setPassword("");
    setError("");
  };

  const subtitle = {
    choose: "Select your login method",
    username: "Sign in with your credentials",
    pin: "Enter your 6-digit staff PIN",
  }[mode];

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={56} height={56} className="mx-auto rounded-xl" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Celsius Staff</h1>
          <p className="mt-1 text-sm text-white/50">Outlet Operations</p>
          <p className="mt-1 text-xs text-white/30">{subtitle}</p>
        </div>

        {mode === "choose" && (
          <div className="space-y-3">
            <Button className="w-full bg-terracotta hover:bg-terracotta-dark" onClick={() => { setMode("username"); setError(""); }}>
              Manager / Admin Login
            </Button>
            <Button variant="outline" className="w-full border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={() => { setMode("pin"); setPin(Array(PIN_LENGTH).fill("")); setError(""); }}>
              Staff PIN Login
            </Button>
          </div>
        )}

        {mode === "username" && (
          <form onSubmit={handleUsernameLogin} className="space-y-4">
            <button type="button" onClick={goBack} className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70">
              <ArrowLeft className="h-3 w-3" />Back
            </button>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/70">Username</label>
              <Input type="text" placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)}
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoFocus autoComplete="username" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/70">Password</label>
              <Input type="password" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoComplete="current-password" />
            </div>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            <Button type="submit" disabled={loading || !username.trim() || !password} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign In
            </Button>
          </form>
        )}

        {mode === "pin" && (
          <div className="space-y-4">
            <button onClick={goBack} className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70">
              <ArrowLeft className="h-3 w-3" />Back
            </button>
            <div className="flex justify-center gap-2">
              {pin.map((digit, i) => (
                <input key={i} ref={(el) => { pinRefs.current[i] = el; }} type="password" inputMode="numeric" maxLength={1} value={digit}
                  onChange={(e) => handlePinChange(i, e.target.value)} onKeyDown={(e) => handlePinKeyDown(i, e)}
                  className="h-12 w-12 rounded-xl border border-white/10 bg-white/5 text-center text-xl font-bold text-white outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta" />
              ))}
            </div>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            {loading && <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/50" /></div>}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-white/30">
          Contact admin if you don&apos;t have access
        </p>
      </div>
    </div>
  );
}
