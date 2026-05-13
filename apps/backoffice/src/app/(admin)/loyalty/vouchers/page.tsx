"use client";

import { useEffect, useState } from "react";
import { TicketPercent } from "lucide-react";

interface IssuedVoucher {
  id: string;
  member_id: string;
  voucher_template_id: string | null;
  source_type: string | null;
  status: string;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <TicketPercent className="w-6 h-6" />
          Vouchers Issued
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Per-customer voucher wallet — issued by Missions, Mystery Bean, Birthday treats, Referrals,
          Milestones, or manual grants. Includes active, used, and expired states.
          <br />
          <span className="text-xs text-muted-foreground/80">
            Not the same as <strong>Points Redemptions</strong> (when a customer spends Beans on a Points Catalog reward — separate log).
          </span>
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Member</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Issued</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Redeemed</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {vouchers.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No vouchers issued yet.</td></tr>
              ) : (
                vouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{v.member_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.source_type ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        v.status === "active" ? "bg-emerald-500/10 text-emerald-500" :
                        v.status === "used"   ? "bg-sky-500/10 text-sky-500" :
                                                "bg-muted text-muted-foreground"
                      }`}>{v.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(v.issued_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.expires_at ? new Date(v.expires_at).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.redeemed_at ? new Date(v.redeemed_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
