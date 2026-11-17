"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { Award, AlertTriangle, CheckCircle2, Loader2, Calendar } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Certification = {
  id: string;
  user_id: string;
  cert_type: string;
  name: string;
  issuer: string | null;
  cert_number: string | null;
  issued_date: string | null;
  expires_at: string | null;
  attachment_url: string | null;
  notes: string | null;
  user_name: string | null;
  outlet_name: string | null;
  days_to_expiry: number | null;
};

type Coverage = {
  cert_type: string;
  valid_holders: number;
  total_staff: number;
};

const CERT_TYPE_LABELS: Record<string, string> = {
  food_handler: "Food Handler",
  halal: "Halal Awareness",
  first_aid: "First Aid",
  fire_safety: "Fire Safety",
  barista: "Barista Skills",
  license: "License",
  other: "Other",
};

const CERT_TYPE_ICONS: Record<string, string> = {
  food_handler: "🍽️",
  halal: "🕌",
  first_aid: "⛑️",
  fire_safety: "🧯",
  barista: "☕",
  license: "🪪",
  other: "📜",
};

type Filter = "expiring" | "expired" | "all";

export default function CertificationsPage() {
  const [filter, setFilter] = useState<Filter>("expiring");
  const [type, setType] = useState<string>("");
  const url = `/api/hr/certifications?filter=${filter}${type ? `&type=${type}` : ""}`;
  const { data, isLoading } = useFetch<{ certifications: Certification[]; coverage: Coverage[] }>(url);
  const certs = data?.certifications || [];
  const coverage = data?.coverage || [];

  // Severity bucket for the row's expiry pill.
  const severity = (days: number | null): "expired" | "urgent" | "warning" | "ok" => {
    if (days == null) return "ok";
    if (days < 0) return "expired";
    if (days <= 7) return "urgent";
    if (days <= 30) return "warning";
    return "ok";
  };

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <HrPageHeader
        title="Training & Certification"
        icon={<Award className="h-6 w-6 text-brand-text" />}
        description="Track Sijil Pengendali Makanan, halal, first aid, and other certs. Inspectors check on the spot — keep these current."
      />

      {/* Coverage rollup — quick "are we compliant?" snapshot */}
      <div className="grid gap-3 md:grid-cols-3">
        {coverage.length === 0 ? (
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground md:col-span-3">
            No certifications uploaded yet. Add the first one from any employee profile.
          </div>
        ) : (
          coverage.map((c) => {
            const pct = c.total_staff > 0 ? (c.valid_holders / c.total_staff) * 100 : 0;
            return (
              <div key={c.cert_type} className="rounded-xl border bg-card p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {CERT_TYPE_ICONS[c.cert_type] || "📜"} {CERT_TYPE_LABELS[c.cert_type] || c.cert_type}
                  </span>
                  <span className={`text-xs font-medium ${pct < 80 ? "text-red-600" : pct < 100 ? "text-amber-600" : "text-emerald-600"}`}>
                    {c.valid_holders}/{c.total_staff} valid
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div
                    className={`h-full transition-all ${pct < 80 ? "bg-red-500" : pct < 100 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2">
        {(["expiring", "expired", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              filter === f ? "border-ink bg-ink text-on-ink" : "bg-background hover:bg-muted"
            }`}
          >
            {f === "expiring" ? "Expiring within 60 days" : f === "expired" ? "Already expired" : "All certifications"}
          </button>
        ))}
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border bg-background px-3 py-1.5 text-xs"
        >
          <option value="">All cert types</option>
          {Object.entries(CERT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{CERT_TYPE_ICONS[k]} {v}</option>
          ))}
        </select>
      </div>

      {/* Cert list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-text-3" /></div>
      ) : certs.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-500" />
          <p className="font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground">
            {filter === "expiring" ? "No certs expiring soon." : filter === "expired" ? "No expired certs." : "No certs match the filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {certs.map((c) => {
            const sev = severity(c.days_to_expiry);
            return (
              <Link
                key={c.id}
                href={`/hr/employees/${c.user_id}#tab=records`}
                className={`flex items-center gap-4 rounded-xl border bg-card p-4 transition hover:shadow-sm ${
                  sev === "expired" ? "border-red-300 bg-red-50/40" : sev === "urgent" ? "border-amber-300 bg-amber-50/30" : ""
                }`}
              >
                <span className="text-2xl">{CERT_TYPE_ICONS[c.cert_type] || "📜"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <p className="font-semibold">{c.user_name || "Unknown"}</p>
                    <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-medium text-text-2">
                      {CERT_TYPE_LABELS[c.cert_type] || c.cert_type}
                    </span>
                    {c.outlet_name && (
                      <span className="text-xs text-muted-foreground">· {c.outlet_name}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.name}
                    {c.issuer && ` · ${c.issuer}`}
                    {c.cert_number && ` · #${c.cert_number}`}
                  </p>
                </div>
                <div className="flex flex-col items-end text-xs">
                  {c.expires_at ? (
                    <>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Calendar className="h-3 w-3" /> Expires {c.expires_at}
                      </span>
                      <span className={`mt-0.5 font-medium ${
                        sev === "expired" ? "text-red-600" :
                        sev === "urgent" ? "text-red-600" :
                        sev === "warning" ? "text-amber-600" : "text-emerald-600"
                      }`}>
                        {sev === "expired"
                          ? `Expired ${Math.abs(c.days_to_expiry!)}d ago`
                          : sev === "urgent" || sev === "warning"
                            ? `${c.days_to_expiry}d left`
                            : `${c.days_to_expiry}d left`}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No expiry</span>
                  )}
                </div>
                {(sev === "expired" || sev === "urgent") && (
                  <AlertTriangle className={`h-5 w-5 ${sev === "expired" ? "text-red-600" : "text-amber-500"}`} />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
