// Customers › Vouchers key numbers (restructure step 6, 17 Nov 2026), worked
// out from the issued-voucher list the page already loads. Pure, so it is
// tested without the page. The question: are vouchers we hand out being used?

export type VoucherRow = {
  status: string;
  source_type: string | null;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
};

export type VoucherSummary = {
  /** active now, and how many of those expire in the next 7 days */
  active: { count: number; expiringSoon: number };
  /** issued in the last 30 days, and how many of those were used */
  issued30: { count: number; used: number; share: number | null };
  /** expired without being used, last 30 days */
  wasted30: number;
  /** source that issued the most vouchers in the last 30 days */
  topSource: { source: string; count: number } | null;
};

const DAY = 86_400_000;

export function summariseVouchers(rows: VoucherRow[], now: number): VoucherSummary {
  const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const active = rows.filter((r) => r.status === "active" && !(t(r.expires_at) <= now));
  const expiringSoon = active.filter((r) => { const e = t(r.expires_at); return e > now && e - now <= 7 * DAY; }).length;

  const recent = rows.filter((r) => now - t(r.issued_at) < 30 * DAY);
  const used = recent.filter((r) => r.status === "used" || !!r.redeemed_at).length;

  const wasted30 = rows.filter((r) => {
    if (r.status === "used" || r.redeemed_at) return false;
    const e = t(r.expires_at);
    return e <= now && now - e < 30 * DAY;
  }).length;

  const bySource = new Map<string, number>();
  for (const r of recent) {
    const k = r.source_type || "other";
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  let topSource: VoucherSummary["topSource"] = null;
  for (const [source, count] of bySource) if (!topSource || count > topSource.count) topSource = { source, count };

  return {
    active: { count: active.length, expiringSoon },
    issued30: { count: recent.length, used, share: recent.length ? used / recent.length : null },
    wasted30,
    topSource,
  };
}
