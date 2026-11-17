"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyNumber } from "@/components/ui/key-number";
import { summariseVouchers } from "@/lib/loyalty/vouchers-summary";

interface IssuedVoucher {
  id: string;
  member_id: string;
  member_name: string | null;
  member_phone: string | null;
  voucher_template_id: string | null;
  reward_id: string | null;
  source_type: string | null;
  status: string;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  title: string | null;
}

const BRAND_ID = "brand-celsius";

export default function ActiveVouchersPage() {
  const [vouchers, setVouchers] = useState<IssuedVoucher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/loyalty/issued-rewards?brand_id=${BRAND_ID}`, { credentials: "include" });
        const data = await res.json();
        setVouchers(Array.isArray(data) ? data : []);
      } catch { setVouchers([]); }
      finally { setLoading(false); }
    })();
  }, []);

  const [now] = useState(() => Date.now());
  const summary = useMemo(() => summariseVouchers(vouchers, now), [vouchers, now]);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
  const label = (src: string | null) => (src ? src.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Other");

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Vouchers</h1>
      <p className="mt-0.5 text-sm text-text-2">Vouchers handed to customers by missions, birthdays, referrals and grants: are they being used?</p>
      <p className="mt-1 text-[12px] text-text-3">Points spent in the points shop are under Redemptions.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Active now" value={loading ? null : summary.active.count.toLocaleString()}
          tone={summary.active.expiringSoon > 0 ? "warn" : undefined}
          note={summary.active.expiringSoon > 0 ? <><b className="font-semibold text-text-2">{summary.active.expiringSoon}</b> expire in 7 days</> : "none expire this week"} />
        <KeyNumber label="Used, issued in 30 days" value={loading ? null : summary.issued30.share == null ? "–" : `${Math.round(summary.issued30.share * 100)}%`}
          note={<><b className="font-semibold text-text-2">{summary.issued30.used}</b> of {summary.issued30.count} issued</>} />
        <KeyNumber label="Expired unused, 30 days" value={loading ? null : summary.wasted30.toLocaleString()}
          tone={summary.wasted30 > 0 ? "warn" : undefined}
          note={summary.wasted30 > 0 ? "customers never came back for these" : "none went to waste"} />
        <KeyNumber word label="Top source, 30 days" value={loading ? null : summary.topSource ? label(summary.topSource.source) : "–"}
          note={summary.topSource ? <><b className="font-semibold text-text-2">{summary.topSource.count}</b> {summary.topSource.count === 1 ? "voucher" : "vouchers"} issued</> : "nothing issued"} />
      </div>

      <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold text-text">
          {loading ? "Loading…" : `${vouchers.length.toLocaleString()} vouchers, newest first`}
        </p>
        {!loading && vouchers.length === 0 && <p className="px-4 py-12 text-center text-sm text-text-3">No vouchers issued yet.</p>}
        {vouchers.map((v) => {
          const used = v.status === "used" || !!v.redeemed_at;
          const chip = used ? "bg-info-soft text-info-text" : v.status === "active" ? "bg-ok-soft text-ok-text" : "bg-sunken text-text-3";
          return (
            <div key={v.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{v.title ?? "Voucher"} <span className="font-normal text-text-3">· {label(v.source_type)}</span></p>
                <p className="mt-0.5 truncate text-[12px] text-text-3">
                  {v.member_name ?? "No name"} · {v.member_phone ?? v.member_id.slice(0, 8) + "…"} · issued {date(v.issued_at)}
                  {used && v.redeemed_at ? ` · used ${date(v.redeemed_at)}` : v.expires_at ? ` · expires ${date(v.expires_at)}` : ""}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] ${chip}`}>{used ? "Used" : v.status === "active" ? "Active" : v.status.replace(/^\w/, (c) => c.toUpperCase())}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
