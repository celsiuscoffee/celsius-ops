"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Loader2, CheckCircle, Star } from "lucide-react";
import { useCartStore } from "@/store/cart";
import type { LoyaltyMember } from "@/store/cart";
import { getSupabaseClient } from "@/lib/supabase/client";

type Step = "phone" | "otp" | "done";

export default function LoginPage() {
  const router = useRouter();
  const setLoyaltyMember = useCartStore((s) => s.setLoyaltyMember);

  const [step,        setStep]        = useState<Step>("phone");
  const [phone,       setPhone]       = useState("");
  const [otp,         setOtp]         = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [member,      setMember]      = useState<LoyaltyMember | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Format phone to +60 format
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("60"))  return `+${digits}`;
    if (digits.startsWith("0"))   return `+6${digits}`;
    return `+60${digits}`;
  }

  async function handleSendOTP() {
    if (!phone.trim()) {
      setError("Please enter your phone number");
      return;
    }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) {
      setError("Please enter a valid Malaysian phone number");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const normalized = normalizePhone(phone);
      const res  = await fetch("/api/loyalty/otp/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone: normalized }),
      });
      const data = await res.json();

      if (data.success === false) {
        setError(data.error ?? "Failed to send OTP");
      } else {
        setPhone(normalized); // store normalised form
        setStep("otp");
        // 30-second cooldown before resend allowed
        setResendCooldown(30);
        const interval = setInterval(() => {
          setResendCooldown((c) => {
            if (c <= 1) { clearInterval(interval); return 0; }
            return c - 1;
          });
        }, 1000);
      }
    } catch {
      setError("Could not send OTP. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (!otp.trim() || otp.length < 4) return;
    setLoading(true);
    setError(null);

    try {
      const res  = await fetch("/api/loyalty/otp/verify", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone, code: otp }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error ?? "Invalid code. Try again.");
      } else {
        const m = data.member as LoyaltyMember | null;
        setMember(m);
        setLoyaltyMember(m);
        // Best-effort enrol — creates member in loyalty if not yet registered
        fetch("/api/loyalty/register", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ phone }),
        }).catch(() => { /* non-fatal */ });
        setStep("done");
      }
    } catch {
      setError("Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/account/login/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.back()} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Sign In</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Star className="h-6 w-6 text-amber-400 fill-amber-400" />
          </div>
          <div>
            <p className="text-white font-bold">Celsius Rewards</p>
            <p className="text-white/60 text-sm">Earn 1 point per RM1 spent</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 space-y-4">
        {step === "phone" && (
          <>
            {/* Google sign-in */}
            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full bg-white border border-border rounded-2xl px-4 py-4 flex items-center gap-3 font-semibold text-sm shadow-sm active:bg-muted/50 disabled:opacity-60"
            >
              {googleLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              <span className="flex-1 text-left">Continue with Google</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Phone OTP */}
            <div className="bg-white rounded-2xl p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-[#160800] mb-1">Phone Number</p>
                <p className="text-xs text-muted-foreground mb-3">We&apos;ll send a 6-digit code via SMS</p>
                <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-3 bg-muted/20 focus-within:border-primary/40 focus-within:bg-white transition-all">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground font-medium shrink-0">+60</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="12-345 6789"
                    value={phone.replace(/^\+?6?0?/, "")}
                    onChange={(e) => { setPhone(e.target.value); setError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
                    className="flex-1 bg-transparent text-sm outline-none font-medium"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={handleSendOTP}
                disabled={loading || !phone.trim()}
                className="w-full bg-[#160800] text-white rounded-full py-3.5 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Send Code
              </button>
            </div>

            <p className="text-center text-xs text-muted-foreground px-4">
              By signing in, you agree to earn and redeem Celsius Rewards points
            </p>
          </>
        )}

        {step === "otp" && (
          <div className="bg-white rounded-2xl p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[#160800] mb-1">Enter OTP</p>
              <p className="text-xs text-muted-foreground mb-3">
                Sent to <span className="font-medium">{phone}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="• • • • • •"
                value={otp}
                onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleVerifyOTP()}
                className="w-full border border-border rounded-xl px-4 py-4 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-primary/40 bg-muted/20 focus:bg-white transition-all"
                autoFocus
              />
            </div>

            {error && <p className="text-xs text-red-500 text-center">{error}</p>}

            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length < 4}
              className="w-full bg-[#160800] text-white rounded-full py-3.5 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify & Sign In
            </button>

            <div className="flex items-center justify-between">
              <button
                onClick={() => { setStep("phone"); setOtp(""); setError(null); }}
                className="text-sm text-muted-foreground py-1"
              >
                Change number
              </button>
              <button
                onClick={() => { setOtp(""); setError(null); handleSendOTP(); }}
                disabled={resendCooldown > 0 || loading}
                className="text-sm text-primary font-semibold py-1 disabled:opacity-40"
              >
                {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend Code"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-emerald-600" />
            </div>
            <div>
              <p className="font-black text-2xl text-[#160800]">
                Welcome{member?.name ? `, ${member.name.split(" ")[0]}` : ""}!
              </p>
              <p className="text-muted-foreground text-sm mt-1">You&apos;re signed in</p>
            </div>

            {member && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 w-full">
                <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide mb-1">Your Points</p>
                <p className="text-4xl font-black text-amber-600">{member.pointsBalance.toLocaleString()}</p>
                <p className="text-xs text-amber-600 mt-1">{member.totalVisits} visits · {member.totalPointsEarned.toLocaleString()} total earned</p>
              </div>
            )}

            <button
              onClick={() => router.push("/account")}
              className="w-full bg-[#160800] text-white rounded-full py-3.5 font-semibold text-sm mt-2"
            >
              Back to Account
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
