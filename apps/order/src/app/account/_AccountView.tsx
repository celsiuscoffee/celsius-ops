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
        <div className="flex flex-col items-center px-6 py-12">
          <User size={48} color="#8E8E93" strokeWidth={1.25} />
          <p
            className="mt-4 text-base"
            style={{ fontFamily: "Peachi-Bold, serif", fontWeight: 700 }}
          >
            Sign in to Celsius
          </p>
          <p className="text-sm text-[#6E6E73] mt-1 text-center">
            Earn beans, redeem rewards, see your order history.
          </p>
          <a
            href="/account?signin=1"
            className="mt-6 rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Sign in with phone
          </a>
        </div>
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
