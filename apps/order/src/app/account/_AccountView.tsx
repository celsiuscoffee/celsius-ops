"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, ChevronRight, LogOut } from "lucide-react";

type Persisted = {
  state?: {
    phone?: string | null;
    member?: {
      name?: string | null;
      pointsBalance?: number;
      totalVisits?: number;
      email?: string | null;
    };
  };
};

/**
 * Account screen. OTP sign-in is a complex multi-step flow with the
 * server's /api/otp endpoints — to keep this minimal, the actual
 * sign-in flow still lives in the SPA. This Next.js page shows
 * profile info if already signed in, otherwise a sign-in CTA that
 * deep-links to the SPA's /account.
 *
 * (When the SPA's account screen ports to Next.js, the OTP flow will
 * live here too.)
 */
export function AccountView() {
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [beans, setBeans] = useState(0);
  const [visits, setVisits] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setPhone(parsed.state?.phone ?? null);
        setName(parsed.state?.member?.name ?? null);
        setBeans(parsed.state?.member?.pointsBalance ?? 0);
        setVisits(parsed.state?.member?.totalVisits ?? 0);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <h1
          className="text-[22px]"
          style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
        >
          Account
        </h1>
      </header>

      {!hydrated ? null : !phone ? (
        <SignInForm
          onSignedIn={(p, member) => {
            // Persist phone + member into the SPA's localStorage shape
            // so the rest of the app picks them up.
            try {
              const raw = window.localStorage.getItem("celsius-pickup");
              const parsed = raw ? JSON.parse(raw) : { state: {} };
              const state = parsed.state ?? {};
              state.phone = p;
              if (member) {
                state.member = member;
                state.loyaltyId = member.id;
              }
              window.localStorage.setItem(
                "celsius-pickup",
                JSON.stringify({ ...parsed, state }),
              );
            } catch {
              /* ignore */
            }
            setPhone(p);
            setName(member?.name ?? null);
            setBeans(member?.pointsBalance ?? 0);
            setVisits(member?.totalVisits ?? 0);
          }}
        />
      ) : (
        <div className="px-4 pt-4 flex flex-col gap-3">
          <section
            className="bg-[#160800] text-white rounded-2xl p-5"
            style={{ minHeight: 120 }}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/60">Hello</p>
            <p
              className="mt-1 text-2xl"
              style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
            >
              {name ?? phone}
            </p>
            <div className="mt-4 flex gap-6">
              <div>
                <p className="text-xl font-bold">{beans.toLocaleString()}</p>
                <p className="text-[10px] uppercase tracking-widest text-white/60">Beans</p>
              </div>
              <div>
                <p className="text-xl font-bold">{visits}</p>
                <p className="text-[10px] uppercase tracking-widest text-white/60">Visits</p>
              </div>
            </div>
          </section>

          <Row href="/orders" label="Order history" />
          <Row href="/rewards" label="Rewards" />
          <Row href="/account?edit=1" label="Edit profile" />
          <Row href="/account?signout=1" label="Sign out" Icon={LogOut} />
        </div>
      )}
    </>
  );
}

function SignInForm({
  onSignedIn,
}: {
  onSignedIn: (
    phone: string,
    member: { id: string; name?: string | null; pointsBalance?: number; totalVisits?: number } | null,
  ) => void;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalisedPhone = (() => {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("60")) return `+${digits}`;
    if (digits.startsWith("0")) return `+6${digits}`;
    return `+60${digits}`;
  })();

  const sendOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalisedPhone, purpose: "signin" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalisedPhone, code, purpose: "signin" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      onSignedIn(normalisedPhone, data.member ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pt-8 pb-4 flex flex-col items-center">
      <User size={48} color="#8E8E93" strokeWidth={1.25} />
      <p className="mt-4 font-peachi font-bold text-base">Sign in to Celsius</p>
      <p className="text-sm text-[#6E6E73] mt-1 text-center max-w-xs">
        Earn beans, redeem rewards, see your order history.
      </p>

      <div className="w-full max-w-sm mt-8">
        {step === "phone" ? (
          <>
            <label className="block text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-2">
              Phone number
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-[#EBE5DE] px-3">
              <span className="text-[#8E8E93] font-bold">+60</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="12 345 6789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 py-3 outline-none text-base"
              />
            </div>
            {error ? (
              <p className="mt-3 text-[12px] text-red-600">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={sendOtp}
              disabled={busy || normalisedPhone.length < 11}
              className={`mt-5 w-full rounded-full text-white py-4 font-bold active:opacity-80 ${
                busy || normalisedPhone.length < 11 ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
              }`}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <label className="block text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-2">
              6-digit code sent to {normalisedPhone}
            </label>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-2xl border border-[#EBE5DE] px-3 py-3 outline-none text-2xl text-center tracking-widest font-bold"
            />
            {error ? (
              <p className="mt-3 text-[12px] text-red-600">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={verifyOtp}
              disabled={busy || code.length !== 6}
              className={`mt-5 w-full rounded-full text-white py-4 font-bold active:opacity-80 ${
                busy || code.length !== 6 ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
              }`}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("phone"); setCode(""); setError(null); }}
              className="mt-3 w-full text-sm text-[#8E8E93] active:opacity-60"
            >
              ← Change number
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon?: typeof User;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 bg-white border border-[#EBE5DE] rounded-2xl px-4 py-3 active:opacity-80"
    >
      {Icon ? <Icon size={18} color="#8E8E93" /> : null}
      <span className="text-sm font-bold flex-1">{label}</span>
      <ChevronRight size={14} color="#8E8E93" />
    </Link>
  );
}
