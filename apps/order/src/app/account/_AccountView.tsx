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
          <EditProfileRow
            phone={phone}
            onSaved={(member) => {
              setName(member?.name ?? null);
              try {
                const raw = window.localStorage.getItem("celsius-pickup");
                const parsed = raw ? JSON.parse(raw) : { state: {} };
                const s = parsed.state ?? {};
                s.member = { ...(s.member ?? {}), ...member };
                window.localStorage.setItem(
                  "celsius-pickup",
                  JSON.stringify({ ...parsed, state: s }),
                );
              } catch {
                /* ignore */
              }
            }}
          />
          <SignOutRow
            onConfirm={() => {
              try {
                const raw = window.localStorage.getItem("celsius-pickup");
                const parsed = raw ? JSON.parse(raw) : { state: {} };
                const s = parsed.state ?? {};
                s.phone = null;
                s.loyaltyId = null;
                s.member = null;
                s.cart = [];
                s.appliedReward = null;
                s.sessionToken = null;
                s.reservedVoucher = null;
                window.localStorage.setItem(
                  "celsius-pickup",
                  JSON.stringify({ ...parsed, state: s }),
                );
              } catch {
                /* ignore */
              }
              setPhone(null);
              setName(null);
              setBeans(0);
              setVisits(0);
            }}
          />
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

function EditProfileRow({
  phone,
  onSaved,
}: {
  phone: string;
  onSaved: (member: { id?: string; name?: string | null; email?: string | null; birthday?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate fields from localStorage when the form opens so the
  // customer sees their current values, not blanks.
  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const m = (JSON.parse(raw) as {
          state?: { member?: { name?: string | null; email?: string | null; birthday?: string | null; id?: string } };
        }).state?.member;
        setName(m?.name ?? "");
        setEmail(m?.email ?? "");
        setBirthday(m?.birthday ?? "");
      }
    } catch {
      /* ignore */
    }
  }, [open]);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      const memberId = raw
        ? (JSON.parse(raw) as { state?: { loyaltyId?: string | null } }).state?.loyaltyId
        : null;
      const res = await fetch("/api/members/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          phone,
          name:     name.trim() || undefined,
          email:    email.trim() || undefined,
          birthday: birthday.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ id: memberId ?? undefined, name, email, birthday });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 bg-white border border-[#EBE5DE] rounded-2xl px-4 py-3 active:opacity-80 text-left"
      >
        <span className="text-sm font-bold flex-1">Edit profile</span>
        <ChevronRight size={14} color="#8E8E93" />
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-[#EBE5DE] p-4">
      <p className="font-peachi font-bold text-[16px] mb-3">Edit profile</p>
      <label className="block text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-1">
        Name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-[#EBE5DE] px-3 py-2 outline-none text-sm mb-3"
      />
      <label className="block text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-1">
        Email
      </label>
      <input
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-xl border border-[#EBE5DE] px-3 py-2 outline-none text-sm mb-3"
      />
      <label className="block text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-1">
        Birthday (DD/MM/YYYY)
      </label>
      <input
        type="text"
        inputMode="numeric"
        placeholder="01/01/1990"
        value={birthday}
        onChange={(e) => setBirthday(e.target.value)}
        className="w-full rounded-xl border border-[#EBE5DE] px-3 py-2 outline-none text-sm mb-3"
      />
      {error ? <p className="text-[12px] text-red-600 mb-2">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 rounded-full border border-[#EBE5DE] text-[#160800] py-3 font-bold active:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className={`flex-1 rounded-full text-white py-3 font-bold active:opacity-80 ${busy ? "bg-[#A2492C]/40" : "bg-[#A2492C]"}`}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function SignOutRow({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-3 bg-white border border-[#EBE5DE] rounded-2xl px-4 py-3 active:opacity-80 text-left"
      >
        <LogOut size={18} color="#8E8E93" />
        <span className="text-sm font-bold flex-1">Sign out</span>
        <ChevronRight size={14} color="#8E8E93" />
      </button>
    );
  }
  return (
    <div className="rounded-2xl bg-white border border-[#EBE5DE] p-4">
      <p className="font-peachi font-bold text-[15px]">Sign out of Celsius?</p>
      <p className="text-[12px] text-[#6E6E73] mt-1">
        Your cart, beans, and rewards stay on the account — sign in again any time.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-full border border-[#EBE5DE] text-[#160800] py-3 font-bold active:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-full bg-[#B91C1C] text-white py-3 font-bold active:opacity-80"
        >
          Sign out
        </button>
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
