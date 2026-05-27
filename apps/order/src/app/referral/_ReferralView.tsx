"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, Users } from "lucide-react";

/**
 * Referral page — share code + see signups. Wired to /api/loyalty/me
 * /referral (same as the SPA's referral screen).
 */
type Referral = {
  code?: string | null;
  total_referred?: number;
  reward_summary?: string | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

export function ReferralView() {
  const [data, setData] = useState<Referral | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
    } catch {
      /* ignore */
    }
    if (!token) return;
    fetch("/api/loyalty/me/referral", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData((d ?? null) as Referral | null))
      .catch(() => setData(null));
  }, []);

  const copy = async () => {
    if (!data?.code) return;
    try {
      await navigator.clipboard.writeText(data.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/rewards" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Refer a friend</h1>
      </header>

      <section className="px-4 pt-5">
        <div
          className="rounded-2xl bg-[#160800] text-white p-5"
          style={{ minHeight: 140 }}
        >
          <span
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(251,191,36,0.18)" }}
          >
            <Users size={18} color="#FBBF24" strokeWidth={1.8} />
          </span>
          <p className="mt-3 text-[10px] uppercase tracking-widest text-white/60">Your code</p>
          <p className="mt-1 font-peachi font-bold text-3xl tracking-widest">
            {data?.code ?? "—"}
          </p>
          {data?.reward_summary ? (
            <p className="mt-3 text-[12px] text-white/70 leading-snug">
              {data.reward_summary}
            </p>
          ) : null}
          <button
            type="button"
            onClick={copy}
            disabled={!data?.code}
            className={`mt-4 rounded-full px-4 py-2 text-[12px] font-bold flex items-center gap-2 active:opacity-80 ${
              data?.code ? "bg-[#FBBF24] text-[#160800]" : "bg-white/15 text-white/50"
            }`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
      </section>

      <section className="px-4 pt-5">
        <p className="text-[11px] uppercase tracking-widest text-[#8E8E93] font-bold mb-1">
          Friends signed up
        </p>
        <p className="font-peachi font-bold text-2xl">{data?.total_referred ?? 0}</p>
      </section>
    </>
  );
}
