"use client";

import { useEffect, useState } from "react";
import {
  Hash,
  Percent,
  Coins,
  Wallet,
  Wrench,
  AppWindow,
  MessageSquare,
  Megaphone,
  CreditCard,
  Save,
  Loader2,
} from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

type SST = { rate: number; enabled: boolean };
type PointsPerRm = { rate: number };
type MinOrder = { rm: number };
type Maintenance = { enabled: boolean; message: string };
type MinAppVersion = { ios: string; android: string; forceUpdate: boolean };
type OrderReadySms = { template: string };
type PromoBanner = {
  enabled: boolean;
  label?: string;
  headline?: string;
  highlight?: string;
  description?: string;
  image_url?: string;
  cta_text?: string;
  cta_target?: "menu" | "store" | "rewards" | "url";
  cta_url?: string;
};
type PaymentsEnabled = { enabled: boolean };

const SETTINGS_API = "/api/settings";

export default function SystemSettingsPage() {
  const [sst, setSst] = useState<SST>({ rate: 0.06, enabled: true });
  const [pts, setPts] = useState<PointsPerRm>({ rate: 1 });
  const [minOrder, setMinOrder] = useState<MinOrder>({ rm: 0 });
  const [maint, setMaint] = useState<Maintenance>({ enabled: false, message: "" });
  const [appVer, setAppVer] = useState<MinAppVersion>({ ios: "1.0.0", android: "1.0.0", forceUpdate: false });
  const [orderReady, setOrderReady] = useState<OrderReadySms>({ template: "" });
  const [promo, setPromo] = useState<PromoBanner>({ enabled: false });
  const [payments, setPayments] = useState<PaymentsEnabled>({ enabled: true });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const keys = [
          "sst",
          "points_per_rm",
          "min_order_value",
          "maintenance",
          "min_app_version",
          "order_ready_sms",
          "promo_banner",
          "payments_enabled",
        ];
        const results = await Promise.all(
          keys.map((k) =>
            adminFetch(`${SETTINGS_API}?key=${encodeURIComponent(k)}`).then((r) =>
              r.json().catch(() => null)
            )
          )
        );
        if (results[0]) setSst(results[0]);
        if (results[1]) setPts(results[1]);
        if (results[2]) setMinOrder(results[2]);
        if (results[3]) setMaint(results[3]);
        if (results[4]) setAppVer(results[4]);
        if (results[5]) setOrderReady(results[5]);
        if (results[6]) setPromo(results[6]);
        if (results[7]) setPayments(results[7]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (key: string, value: unknown) => {
    setSaving(key);
    try {
      // Backoffice's own /api/settings — same Supabase table the order app
      // and pickup app read from at runtime. Single source of truth.
      const res = await adminFetch(SETTINGS_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(`${key} saved`);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
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
          Global settings consumed by the pickup app, PWA, and order endpoint.
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Payments kill-switch */}
        <Card icon={<CreditCard className="h-4.5 w-4.5 text-emerald-600" />} bg="bg-emerald-50"
              title="Online payments"
              sub="Master switch for Stripe checkout. Off = customer app shows 'ordering paused'.">
          <Field label="Enabled">
            <Toggle checked={payments.enabled} onChange={(v) => setPayments({ enabled: v })} />
          </Field>
          <SaveBtn busy={saving === "payments_enabled"} onClick={() => save("payments_enabled", payments)} />
        </Card>

        {/* SST */}
        <Card icon={<Percent className="h-4.5 w-4.5 text-amber-600" />} bg="bg-amber-50"
              title="SST (Sales & Service Tax)"
              sub="Applied at checkout after rewards/voucher discounts">
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

        {/* Min order value */}
        <Card icon={<Wallet className="h-4.5 w-4.5 text-sky-600" />} bg="bg-sky-50"
              title="Minimum order value"
              sub="Block checkout below this RM amount. 0 = no minimum.">
          <Field label="RM" inline>
            <input type="number" step="1" min={0}
              value={minOrder.rm}
              onChange={(e) => setMinOrder({ rm: Number(e.target.value) })}
              className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
          <SaveBtn busy={saving === "min_order_value"} onClick={() => save("min_order_value", minOrder)} />
        </Card>

        {/* Maintenance */}
        <Card icon={<Wrench className="h-4.5 w-4.5 text-orange-600" />} bg="bg-orange-50"
              title="Maintenance banner"
              sub="Red banner shown across the entire pickup app when on">
          <Field label="Enabled">
            <Toggle checked={maint.enabled} onChange={(v) => setMaint({ ...maint, enabled: v })} />
          </Field>
          <Field label="Message">
            <input type="text"
              value={maint.message}
              onChange={(e) => setMaint({ ...maint, message: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Brief outage — back at 11am" />
          </Field>
          <SaveBtn busy={saving === "maintenance"} onClick={() => save("maintenance", maint)} />
        </Card>

        {/* Min app version */}
        <Card icon={<AppWindow className="h-4.5 w-4.5 text-violet-600" />} bg="bg-violet-50"
              title="Minimum app version"
              sub="Force-update older installs. App reads this on launch.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="iOS min version">
              <input type="text"
                value={appVer.ios}
                onChange={(e) => setAppVer({ ...appVer, ios: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="1.0.0" />
            </Field>
            <Field label="Android min version">
              <input type="text"
                value={appVer.android}
                onChange={(e) => setAppVer({ ...appVer, android: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="1.0.0" />
            </Field>
          </div>
          <Field label="Force update">
            <Toggle checked={appVer.forceUpdate} onChange={(v) => setAppVer({ ...appVer, forceUpdate: v })} />
          </Field>
          <SaveBtn busy={saving === "min_app_version"} onClick={() => save("min_app_version", appVer)} />
        </Card>

        {/* Order ready SMS */}
        <Card icon={<MessageSquare className="h-4.5 w-4.5 text-indigo-600" />} bg="bg-indigo-50"
              title="Order-ready SMS template"
              sub="Sent when staff marks an order ready. Tokens: {orderNumber}, {outletName}">
          <Field label="Template">
            <textarea
              value={orderReady.template}
              onChange={(e) => setOrderReady({ template: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={3} />
          </Field>
          <SaveBtn busy={saving === "order_ready_sms"} onClick={() => save("order_ready_sms", orderReady)} />
        </Card>

        {/* Promo banner */}
        <Card icon={<Megaphone className="h-4.5 w-4.5 text-rose-600" />} bg="bg-rose-50"
              title="Homescreen promo banner"
              sub="Persistent strip below header (PWA today; native soon)">
          <Field label="Enabled">
            <Toggle checked={promo.enabled} onChange={(v) => setPromo({ ...promo, enabled: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <input type="text"
                value={promo.label ?? ""}
                onChange={(e) => setPromo({ ...promo, label: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="App PROMO" />
            </Field>
            <Field label="Highlight">
              <input type="text"
                value={promo.highlight ?? ""}
                onChange={(e) => setPromo({ ...promo, highlight: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Free 1" />
            </Field>
          </div>
          <Field label="Headline">
            <input type="text"
              value={promo.headline ?? ""}
              onChange={(e) => setPromo({ ...promo, headline: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Buy 1" />
          </Field>
          <Field label="Description">
            <input type="text"
              value={promo.description ?? ""}
              onChange={(e) => setPromo({ ...promo, description: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="First app order · Any drink · Any size" />
          </Field>
          <Field label="Hero image URL (optional · 16:9 recommended)">
            <input type="text"
              value={promo.image_url ?? ""}
              onChange={(e) => setPromo({ ...promo, image_url: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="https://...campaign-hero.jpg" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CTA text">
              <input type="text"
                value={promo.cta_text ?? ""}
                onChange={(e) => setPromo({ ...promo, cta_text: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Order Now" />
            </Field>
            <Field label="CTA target">
              <select
                value={promo.cta_target ?? "menu"}
                onChange={(e) => setPromo({ ...promo, cta_target: e.target.value as PromoBanner["cta_target"] })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="menu">Menu</option>
                <option value="store">Pick outlet</option>
                <option value="rewards">Rewards</option>
                <option value="url">External URL</option>
              </select>
            </Field>
          </div>
          {promo.cta_target === "url" && (
            <Field label="External URL">
              <input type="text"
                value={promo.cta_url ?? ""}
                onChange={(e) => setPromo({ ...promo, cta_url: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="https://..." />
            </Field>
          )}
          <SaveBtn busy={saving === "promo_banner"} onClick={() => save("promo_banner", promo)} />
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
