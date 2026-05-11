"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  Wrench,
  AppWindow,
  CreditCard,
  Save,
  Loader2,
  Clock,
  Tag,
  Bell,
  Send,
} from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

// Persisted setting types — keep in sync with /settings/system/page.tsx
// (the org-wide siblings) and with the pickup app's runtime readers.
type MinOrder = { rm: number };
type Maintenance = { enabled: boolean; message: string };
type MinAppVersion = { ios: string; android: string; forceUpdate: boolean };
type PaymentsEnabled = { enabled: boolean };

type OutletHours = { open: string; close: string; daysOpen: number[] };
type OutletHoursMap = Record<string, OutletHours>;

type FirstOrderDiscount = { enabled: boolean; type: "percent" | "fixed"; amount: number; label: string };

const OUTLET_LABELS: Record<string, string> = {
  conezion:   "Putrajaya (Conezion)",
  "shah-alam": "Shah Alam",
  tamarind:   "Tamarind Square",
};
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const DEFAULT_OUTLET_HOURS: OutletHours = { open: "08:00", close: "22:00", daysOpen: [1, 2, 3, 4, 5, 6, 7] };
const DEFAULT_FIRST_ORDER: FirstOrderDiscount = { enabled: false, type: "percent", amount: 10, label: "" };

const SETTINGS_API = "/api/settings";

export default function PickupSettingsPage() {
  const [minOrder, setMinOrder] = useState<MinOrder>({ rm: 0 });
  const [maint, setMaint] = useState<Maintenance>({ enabled: false, message: "" });
  const [appVer, setAppVer] = useState<MinAppVersion>({ ios: "1.0.0", android: "1.0.0", forceUpdate: false });
  const [payments, setPayments] = useState<PaymentsEnabled>({ enabled: true });
  const [outletHours, setOutletHours] = useState<OutletHoursMap>({
    conezion:    { ...DEFAULT_OUTLET_HOURS },
    "shah-alam": { ...DEFAULT_OUTLET_HOURS },
    tamarind:    { ...DEFAULT_OUTLET_HOURS },
  });
  const [firstOrder, setFirstOrder] = useState<FirstOrderDiscount>(DEFAULT_FIRST_ORDER);

  // Push blast (action — not a persisted setting)
  const [blastTitle, setBlastTitle] = useState("");
  const [blastBody, setBlastBody] = useState("");
  const [blastTokenCount, setBlastTokenCount] = useState<number | null>(null);
  const [blasting, setBlasting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const keys = [
          "min_order_value",
          "maintenance",
          "min_app_version",
          "payments_enabled",
          "outlet_hours",
          "first_order_discount",
        ];
        const [settingsResults, tokenCountRes] = await Promise.all([
          Promise.all(
            keys.map((k) =>
              adminFetch(`${SETTINGS_API}?key=${encodeURIComponent(k)}`).then((r) =>
                r.json().catch(() => null)
              )
            )
          ),
          adminFetch("/api/push/expo-token-count").then((r) => r.json().catch(() => null)),
        ]);
        const results = settingsResults;
        if (results[0]) setMinOrder(results[0]);
        if (results[1]) setMaint(results[1]);
        if (results[2]) setAppVer(results[2]);
        if (results[3]) setPayments(results[3]);
        if (results[4]) setOutletHours(results[4]);
        if (results[5]) setFirstOrder(results[5]);
        if (tokenCountRes?.count !== undefined) setBlastTokenCount(tokenCountRes.count);
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  const toggleOutletDay = (storeId: string, day: number) => {
    setOutletHours((prev) => {
      const cur = prev[storeId] ?? { ...DEFAULT_OUTLET_HOURS };
      const days = cur.daysOpen.includes(day)
        ? cur.daysOpen.filter((d) => d !== day)
        : [...cur.daysOpen, day].sort((a, b) => a - b);
      return { ...prev, [storeId]: { ...cur, daysOpen: days } };
    });
  };

  const sendBlast = async () => {
    if (!blastTitle.trim() || !blastBody.trim()) return;
    setBlasting(true);
    try {
      const res = await adminFetch("/api/push/expo-blast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: blastTitle, body: blastBody }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Blast failed");
      toast.success(`Sent to ${json.sent} device${json.sent !== 1 ? "s" : ""}${json.failed ? ` · ${json.failed} failed` : ""}`);
      setBlastTitle("");
      setBlastBody("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Blast failed";
      toast.error(msg);
    } finally {
      setBlasting(false);
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
        <h2 className="text-xl font-semibold text-gray-900">Pickup App Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Settings consumed by the customer-facing pickup app and order endpoint.
          Org-wide settings (SST, loyalty earn rate, staff PIN) live under
          Settings → System.
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

        {/* Outlet ordering hours */}
        <Card icon={<Clock className="h-4.5 w-4.5 text-teal-600" />} bg="bg-teal-50"
              title="Ordering hours"
              sub="Auto-open / auto-close via cron. Days: 1=Mon … 7=Sun.">
          <div className="mt-2 space-y-3">
            {Object.entries(outletHours).map(([storeId, hours]) => (
              <div key={storeId} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="mb-2 text-xs font-semibold text-gray-700">
                  {OUTLET_LABELS[storeId] ?? storeId}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    Open
                    <input type="time" value={hours.open}
                      onChange={(e) => setOutletHours((p) => ({ ...p, [storeId]: { ...p[storeId]!, open: e.target.value } }))}
                      className="rounded border border-gray-200 px-2 py-1 text-xs" />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    Close
                    <input type="time" value={hours.close}
                      onChange={(e) => setOutletHours((p) => ({ ...p, [storeId]: { ...p[storeId]!, close: e.target.value } }))}
                      className="rounded border border-gray-200 px-2 py-1 text-xs" />
                  </label>
                  <div className="flex gap-1">
                    {DAY_LABELS.map((d, i) => {
                      const day = i + 1;
                      const active = hours.daysOpen.includes(day);
                      return (
                        <button key={day} type="button"
                          onClick={() => toggleOutletDay(storeId, day)}
                          className={`h-6 w-6 rounded text-[10px] font-semibold transition-colors ${
                            active ? "bg-teal-600 text-white" : "bg-white text-gray-400 border border-gray-200"
                          }`}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <SaveBtn busy={saving === "outlet_hours"} onClick={() => save("outlet_hours", outletHours)} />
        </Card>

        {/* First-order discount */}
        <Card icon={<Tag className="h-4.5 w-4.5 text-pink-600" />} bg="bg-pink-50"
              title="First-order discount"
              sub="Applied automatically when a member has zero prior completed orders">
          <Field label="Enabled">
            <Toggle checked={firstOrder.enabled} onChange={(v) => setFirstOrder({ ...firstOrder, enabled: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={firstOrder.type}
                onChange={(e) => setFirstOrder({ ...firstOrder, type: e.target.value as "percent" | "fixed" })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="percent">Percent (%)</option>
                <option value="fixed">Fixed (RM)</option>
              </select>
            </Field>
            <Field label={firstOrder.type === "percent" ? "Discount %" : "Discount RM"}>
              <input type="number" step="1" min={0} max={firstOrder.type === "percent" ? 100 : 999}
                value={firstOrder.amount}
                onChange={(e) => setFirstOrder({ ...firstOrder, amount: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label="Label shown to customer (optional)">
            <input type="text" value={firstOrder.label}
              onChange={(e) => setFirstOrder({ ...firstOrder, label: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Welcome — 10% off your first order" />
          </Field>
          <SaveBtn busy={saving === "first_order_discount"} onClick={() => save("first_order_discount", firstOrder)} />
        </Card>

        {/* Push blast */}
        <Card icon={<Bell className="h-4.5 w-4.5 text-blue-600" />} bg="bg-blue-50"
              title="Push notification blast"
              sub={`Send to all registered devices · ${blastTokenCount === null ? "…" : blastTokenCount} token${blastTokenCount !== 1 ? "s" : ""} registered`}>
          <Field label="Title">
            <input type="text" value={blastTitle}
              onChange={(e) => setBlastTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="New menu drop 🎉" />
          </Field>
          <Field label="Body">
            <textarea value={blastBody}
              onChange={(e) => setBlastBody(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Check out our new seasonal drinks, available now at all outlets." />
          </Field>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={sendBlast}
              disabled={blasting || !blastTitle.trim() || !blastBody.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {blasting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send blast
            </button>
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
