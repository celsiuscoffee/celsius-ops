"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Hash,
  Percent,
  Coins,
  Save,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

// Org-wide settings types — pickup-app config (payments, ordering hours,
// promo banner, etc.) lives at /pickup/settings now. Keep the type set
// trimmed to what this page actually renders.
type SST = { rate: number; enabled: boolean };
type PointsPerRm = { rate: number };

const SETTINGS_API = "/api/settings";

export default function SystemSettingsPage() {
  const [sst, setSst] = useState<SST>({ rate: 0.06, enabled: true });
  const [pts, setPts] = useState<PointsPerRm>({ rate: 1 });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const keys = ["sst", "points_per_rm"];
        const results = await Promise.all(
          keys.map((k) =>
            adminFetch(`${SETTINGS_API}?key=${encodeURIComponent(k)}`).then((r) =>
              r.json().catch(() => null)
            )
          )
        );
        if (results[0]) setSst(results[0]);
        if (results[1]) setPts(results[1]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (key: string, value: unknown) => {
    setSaving(key);
    try {
      const res = await adminFetch(SETTINGS_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(`${key} saved`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">System Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Org-wide settings used across every app (tax, base loyalty earn rate,
          staff PIN policy).
        </p>
      </div>

      {/* Migration notice — pickup-app config moved out of this page on
          2026-05-09. Leaving an explicit pointer so anyone bookmarking the
          old "System" page still finds the relocated cards. */}
      <Link
        href="/pickup/settings"
        className="mb-6 flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 transition-colors hover:bg-blue-100"
      >
        <div>
          <p className="font-semibold">Pickup app config moved</p>
          <p className="mt-0.5 text-xs text-blue-600/80">
            Online payments, ordering hours, promo banner, push blast and
            seven other pickup-specific cards now live under
            Pickup → Settings.
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>

      <div className="max-w-2xl space-y-4">
        {/* SST */}
        <Card icon={<Percent className="h-4.5 w-4.5 text-amber-600" />} bg="bg-amber-50"
              title="SST (Sales & Service Tax)"
              sub="Single setting for ALL channels — pickup, web & in-store POS. Applied at checkout after rewards/voucher discounts.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate (e.g. 0.06 = 6%)">
              <input type="number" step="0.01" min={0} max={0.5}
                value={sst.rate}
                onChange={(e) => setSst({ ...sst, rate: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </Field>
            <Field label="Enabled">
              <Toggle checked={sst.enabled} onChange={(v) => setSst({ ...sst, enabled: v })} />
            </Field>
          </div>
          <SaveBtn busy={saving === "sst"} onClick={() => save("sst", sst)} />
        </Card>

        {/* Points per RM */}
        <Card icon={<Coins className="h-4.5 w-4.5 text-emerald-600" />} bg="bg-emerald-50"
              title="Loyalty: points per RM"
              sub="Base earn rate; e.g. 1 = 1 pt/RM, 2 = double points">
          <Field label="Rate" inline>
            <input type="number" step="0.5" min={0}
              value={pts.rate}
              onChange={(e) => setPts({ rate: Number(e.target.value) })}
              className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
          <SaveBtn busy={saving === "points_per_rm"} onClick={() => save("points_per_rm", pts)} />
        </Card>

        {/* PIN (read-only legacy) */}
        <Card icon={<Hash className="h-4.5 w-4.5 text-violet-600" />} bg="bg-violet-50"
              title="Staff PIN length"
              sub="Standardised at 6 digits — not editable">
          <div className="mt-2 flex items-center gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-3 w-3 rounded-full bg-terracotta" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── small UI helpers ─────────────────────────────────────

function Card({ icon, bg, title, sub, children }: {
  icon: React.ReactNode; bg: string; title: string; sub: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>{icon}</div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, inline }: {
  label: string; children: React.ReactNode; inline?: boolean;
}) {
  return (
    <label className={`mt-3 block ${inline ? "flex items-center gap-3" : ""}`}>
      <span className="block text-[11px] font-medium text-gray-600">{label}</span>
      <div className={inline ? "" : "mt-1"}>{children}</div>
    </label>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
        checked ? "bg-emerald-500" : "bg-gray-300"
      }`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-5" : "translate-x-1"
      }`} />
    </button>
  );
}

function SaveBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <div className="mt-4 flex justify-end">
      <button type="button" onClick={onClick} disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </button>
    </div>
  );
}
