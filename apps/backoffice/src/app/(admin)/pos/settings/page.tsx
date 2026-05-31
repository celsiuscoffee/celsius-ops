"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Store, Receipt, QrCode, Megaphone, CreditCard, LayoutGrid, FileText, Clock } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * POS Settings — canonical editor. Main BO is the source of truth; the
 * POS app reads pos_branch_settings via its own RLS-anon client at
 * runtime and reflects what's set here. POS-local /backoffice/settings
 * still lets a manager tweak on-terminal as a convenience, but this is
 * the authoritative surface.
 */

type Settings = {
  outlet_id:               string;
  service_charge_rate:     number | null;
  default_order_type:      string | null;
  checkout_option:         string | null;
  receipt_header:          string | null;
  receipt_footer:          string | null;
  receipt_show_logo:       boolean | null;
  receipt_qr_url:          string | null;
  receipt_qr_label:        string | null;
  receipt_promo_enabled:   boolean | null;
  receipt_promo_text:      string | null;
  ghl_merchant_id:         string | null;
  ghl_terminal_id:         string | null;
  grid_columns:            number | null;
  layout_mode:             string | null;
  // Tax + LHDN e-Invoice defaults applied to all products that don't override.
  default_tax_rate:        number | null;
  default_tax_inclusive:   boolean | null;
  einvoice_tin:            string | null;
  einvoice_brn:            string | null;
  einvoice_sst_no:         string | null;
  // GrabFood ordering hours — drives the serviceHours we serve to Grab. Outside
  // this window Grab shows "no menu available". 24h overrides the open/close.
  grab_open_time:          string | null;
  grab_close_time:         string | null;
  grab_open_24h:           boolean | null;
};

// Labels come from the shared registry so every app reads the same
// strings (no "Putrajaya (Conezion)" vs "Putrajaya" drift) — see
// packages/shared/src/outlets.ts.
import { outletLabel } from "@celsius/shared";

export default function POSSettingsPage() {
  const [all, setAll] = useState<Settings[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [editing, setEditing] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch("/api/pos/settings");
        const json = await res.json();
        if (cancelled) return;
        const list = (json.settings ?? []) as Settings[];
        setAll(list);
        if (list.length > 0) {
          setSelected(list[0].outlet_id);
          setEditing(list[0]);
        }
      } catch {
        toast.error("Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function pickOutlet(outletId: string) {
    setSelected(outletId);
    const found = all.find((s) => s.outlet_id === outletId);
    setEditing(found ?? null);
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/pos/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Save failed");
      }
      const json = await res.json();
      const saved = json.settings as Settings;
      setAll((prev) => prev.map((s) => (s.outlet_id === saved.outlet_id ? saved : s)));
      setEditing(saved);
      toast.success("Settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setEditing((cur) => (cur ? { ...cur, [key]: value } : cur));
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-[#160800]">POS Settings</h1>
        <p className="mt-2 text-sm text-gray-500">No outlets configured.</p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">POS Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Per-outlet POS register, receipt, and payment terminal settings. The POS app reads from here at runtime.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
      </div>

      {/* Outlet picker */}
      <div className="bg-white rounded-2xl p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Outlet</p>
        <div className="flex flex-wrap gap-2">
          {all.map((s) => (
            <button
              key={s.outlet_id}
              onClick={() => pickOutlet(s.outlet_id)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                selected === s.outlet_id
                  ? "border-[#160800] bg-[#160800] text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-[#160800]"
              }`}
            >
              {outletLabel(s.outlet_id)}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Register */}
        <Section title="Register" Icon={LayoutGrid}>
          <Field label="Service Charge (%)">
            <input
              type="number"
              value={editing.service_charge_rate ?? 0}
              onChange={(e) => update("service_charge_rate", Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Default Order Type">
            <select
              value={editing.default_order_type ?? "takeaway"}
              onChange={(e) => update("default_order_type", e.target.value)}
              className="input"
            >
              <option value="takeaway">Takeaway</option>
              <option value="dine_in">Dine-in</option>
            </select>
          </Field>
          <Field label="Checkout Option">
            <select
              value={editing.checkout_option ?? "queue_number"}
              onChange={(e) => update("checkout_option", e.target.value)}
              className="input"
            >
              <option value="queue_number">Auto Queue Number</option>
              <option value="table_number">Table Number</option>
              <option value="none">None</option>
            </select>
          </Field>
          <Field label="Product Grid Columns">
            <select
              value={editing.grid_columns ?? 6}
              onChange={(e) => update("grid_columns", Number(e.target.value))}
              className="input"
            >
              <option value="4">4 (Large tiles)</option>
              <option value="5">5</option>
              <option value="6">6 (Default)</option>
              <option value="7">7</option>
              <option value="8">8 (Small)</option>
            </select>
          </Field>
        </Section>

        {/* Receipt */}
        <Section title="Receipt" Icon={Receipt}>
          <Field label="Header line">
            <input
              type="text"
              value={editing.receipt_header ?? ""}
              onChange={(e) => update("receipt_header", e.target.value)}
              placeholder="Celsius Coffee"
              className="input"
            />
          </Field>
          <Field label="Footer line">
            <input
              type="text"
              value={editing.receipt_footer ?? ""}
              onChange={(e) => update("receipt_footer", e.target.value)}
              placeholder="Thank you for visiting!"
              className="input"
            />
          </Field>
          <Toggle
            checked={editing.receipt_show_logo !== false}
            onChange={(v) => update("receipt_show_logo", v)}
            label="Show logo on receipt"
          />
        </Section>

        {/* QR */}
        <Section title="QR Code on Receipt" Icon={QrCode}>
          <p className="text-[11px] text-gray-500 -mt-1">Print a QR at the bottom of receipts — e.g. Google Review, social link.</p>
          <Field label="QR URL">
            <input
              type="url"
              value={editing.receipt_qr_url ?? ""}
              onChange={(e) => update("receipt_qr_url", e.target.value)}
              placeholder="https://g.page/r/your-google-review-link"
              className="input font-mono"
            />
          </Field>
          <Field label="Label above QR">
            <input
              type="text"
              value={editing.receipt_qr_label ?? ""}
              onChange={(e) => update("receipt_qr_label", e.target.value)}
              placeholder="Scan to leave us a review!"
              className="input"
            />
          </Field>
        </Section>

        {/* Promo */}
        <Section title="Promotion on Receipt" Icon={Megaphone}>
          <Toggle
            checked={editing.receipt_promo_enabled === true}
            onChange={(v) => update("receipt_promo_enabled", v)}
            label="Print promo on every receipt"
          />
          <Field label="Promo text (multi-line)">
            <textarea
              rows={3}
              value={editing.receipt_promo_text ?? ""}
              onChange={(e) => update("receipt_promo_text", e.target.value)}
              placeholder={"Buy 5 drinks, get 1 FREE!\nAsk about our rewards program"}
              className="input resize-none"
            />
          </Field>
          {editing.receipt_promo_enabled && editing.receipt_promo_text && (
            <div className="rounded-lg border border-dashed border-[#A2492C]/30 bg-[#A2492C]/5 p-3">
              <p className="text-[10px] font-bold text-[#A2492C] uppercase tracking-wide mb-1">Preview</p>
              <p className="whitespace-pre-wrap text-xs font-semibold text-[#160800]">{editing.receipt_promo_text}</p>
            </div>
          )}
        </Section>

        {/* Payment terminals — kept simple; full integrations live in Settings → Integrations */}
        <Section title="GHL Terminal" Icon={CreditCard}>
          <Field label="GHL Merchant ID">
            <input
              type="text"
              value={editing.ghl_merchant_id ?? ""}
              onChange={(e) => update("ghl_merchant_id", e.target.value)}
              className="input font-mono"
              placeholder="MID"
            />
          </Field>
          <Field label="GHL Terminal ID">
            <input
              type="text"
              value={editing.ghl_terminal_id ?? ""}
              onChange={(e) => update("ghl_terminal_id", e.target.value)}
              className="input font-mono"
              placeholder="TID"
            />
          </Field>
        </Section>

        {/* GrabFood ordering hours — drives the menu serviceHours sent to Grab.
            Outside this window Grab serves "no menu available". */}
        <Section title="GrabFood Hours" Icon={Clock}>
          <Toggle
            checked={editing.grab_open_24h === true}
            onChange={(v) => update("grab_open_24h", v)}
            label="Open 24 hours on GrabFood"
          />
          {editing.grab_open_24h !== true && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Opens">
                <input
                  type="time"
                  value={editing.grab_open_time ?? "08:00"}
                  onChange={(e) => update("grab_open_time", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Closes">
                <input
                  type="time"
                  value={editing.grab_close_time ?? "22:00"}
                  onChange={(e) => update("grab_close_time", e.target.value)}
                  className="input"
                />
              </Field>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Outside these hours GrabFood shows &ldquo;no menu available&rdquo;. For past-midnight trade, switch on 24 hours and toggle your store open/closed in the Grab Merchant app.
          </p>
        </Section>

        {/* Tax + LHDN e-Invoice — outlet-level defaults. Products can override
            via the menu editor; everything else inherits from here. */}
        <Section title="Tax & e-Invoice" Icon={FileText}>
          <Field label="Default Tax Rate (%)">
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={editing.default_tax_rate ?? 0}
              onChange={(e) => update("default_tax_rate", e.target.value === "" ? 0 : Number(e.target.value))}
              className="input"
              placeholder="0"
            />
          </Field>
          <Toggle
            checked={editing.default_tax_inclusive !== false}
            onChange={(v) => update("default_tax_inclusive", v)}
            label="Prices are tax-inclusive by default"
          />
          <Field label="TIN (Tax Identification Number)">
            <input
              type="text"
              value={editing.einvoice_tin ?? ""}
              onChange={(e) => update("einvoice_tin", e.target.value)}
              className="input font-mono"
              placeholder="C1234567890"
            />
          </Field>
          <Field label="BRN (Business Registration Number)">
            <input
              type="text"
              value={editing.einvoice_brn ?? ""}
              onChange={(e) => update("einvoice_brn", e.target.value)}
              className="input font-mono"
              placeholder="202101012345"
            />
          </Field>
          <Field label="SST Number">
            <input
              type="text"
              value={editing.einvoice_sst_no ?? ""}
              onChange={(e) => update("einvoice_sst_no", e.target.value)}
              className="input font-mono"
              placeholder="W10-1234-56789012"
            />
          </Field>
        </Section>

        {/* About this outlet — readonly badge */}
        <Section title="Outlet" Icon={Store}>
          <p className="text-sm text-gray-700">
            <span className="font-medium">{outletLabel(editing.outlet_id)}</span>
            <span className="ml-2 text-xs text-gray-400">({editing.outlet_id})</span>
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Outlet master data (name, address, phone) is managed in Settings → Outlets.
          </p>
        </Section>
      </div>

      {/* Helper styles for inputs */}
      <style jsx>{`
        :global(.input) {
          width: 100%;
          height: 2.5rem;
          padding: 0 0.75rem;
          font-size: 0.875rem;
          color: #160800;
          background-color: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          outline: none;
          transition: border-color 0.15s;
        }
        :global(.input:focus) { border-color: #160800; }
        :global(textarea.input) { height: auto; padding: 0.625rem 0.75rem; }
      `}</style>
    </div>
  );
}

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
        <Icon className="h-4 w-4 text-[#A2492C]" />
        <h3 className="text-sm font-bold text-[#160800]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <span className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-5 w-9 rounded-full bg-gray-200 transition-colors peer-checked:bg-[#160800]" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="text-xs text-gray-700">{label}</span>
    </label>
  );
}
