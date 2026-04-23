"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Loader2, CheckCircle2, RefreshCw,
  Wallet, Store, ChevronDown, ChevronRight,
  ShieldCheck, Eye, EyeOff, Save, Zap,
  CreditCard, FileText, Link2, Info,
  BookOpen, Receipt,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────────── */

interface OutletSetting {
  store_id: string;
  stripe_account_id: string | null;
  stripe_onboarded: boolean;
  stripe_enabled: boolean;
  rm_merchant_id: string | null;
  rm_client_id: string | null;
  rm_client_secret: string | null;
  rm_private_key: string | null;
  rm_is_production: boolean;
  rm_enabled: boolean;
  bukku_token: string | null;
  bukku_subdomain: string | null;
  bukku_enabled: boolean;
}

interface PaymentGatewayConfig {
  method_id: string;
  enabled: boolean;
  provider: string;
}

/* ─── Static data ───────────────────────────────────────────────────────── */

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  conezion: "Conezion",
  tamarind: "Tamarind Square",
};

type Provider = "stripe" | "revenue_monster";

const PROVIDERS: { id: Provider; label: string; dot: string }[] = [
  { id: "stripe", label: "Stripe", dot: "bg-[#635BFF]" },
  { id: "revenue_monster", label: "Revenue Monster", dot: "bg-blue-600" },
];

interface MethodDef {
  id: string;
  name: string;
  icon: string;
  providers: Provider[];
  defaultProvider: Provider;
}

const METHOD_DEFS: MethodDef[] = [
  { id: "fpx", name: "FPX Online Banking", icon: "🏦", providers: ["revenue_monster", "stripe"], defaultProvider: "revenue_monster" },
  { id: "card", name: "Credit / Debit Card", icon: "💳", providers: ["stripe", "revenue_monster"], defaultProvider: "stripe" },
  { id: "tng", name: "TNG eWallet", icon: "📱", providers: ["revenue_monster"], defaultProvider: "revenue_monster" },
  { id: "grabpay", name: "GrabPay", icon: "🟢", providers: ["revenue_monster"], defaultProvider: "revenue_monster" },
  { id: "boost", name: "Boost", icon: "🔴", providers: ["revenue_monster"], defaultProvider: "revenue_monster" },
  { id: "apple_pay", name: "Apple Pay", icon: "🍎", providers: ["stripe"], defaultProvider: "stripe" },
  { id: "google_pay", name: "Google Pay", icon: "🔵", providers: ["stripe"], defaultProvider: "stripe" },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function mask(val: string | null) {
  if (!val) return "";
  return val.length <= 8
    ? "--------"
    : `${val.slice(0, 4)}${"*".repeat(Math.min(val.length - 8, 16))}${val.slice(-4)}`;
}

function isRmConfigured(o: OutletSetting) {
  return !!(o.rm_client_id && o.rm_client_secret && o.rm_private_key);
}

function isBukkuConfigured(o: OutletSetting) {
  return !!(o.bukku_token && o.bukku_subdomain);
}

/* ─── Credential Field ──────────────────────────────────────────────────── */

function CredField({
  label, placeholder, existing, value, onChange, textarea,
}: {
  label: string; placeholder: string; existing: string | null;
  value: string; onChange: (v: string) => void; textarea?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isSet = !!existing;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        {isSet && (
          <span className="text-[10px] text-green-600 font-semibold flex items-center gap-0.5">
            <ShieldCheck className="h-3 w-3" />Saved
          </span>
        )}
      </div>
      <div className="relative">
        {textarea ? (
          <textarea
            rows={3}
            placeholder={isSet ? mask(existing) : placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 font-mono bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-terracotta/20 focus:border-terracotta/40 resize-none transition"
          />
        ) : (
          <input
            type={show ? "text" : "password"}
            placeholder={isSet ? mask(existing) : placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pr-9 font-mono bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-terracotta/20 focus:border-terracotta/40 transition"
          />
        )}
        {!textarea && (
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Toggle Switch ─────────────────────────────────────────────────────── */

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-green-500" : "bg-gray-300"} ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ${checked ? "translate-x-4 ml-0.5" : "translate-x-0.5"}`} />
    </button>
  );
}

/* ─── Info Banner ───────────────────────────────────────────────────────── */

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg bg-blue-50/70 border border-blue-100 px-3.5 py-2.5">
      <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
      <p className="text-xs text-blue-700 leading-relaxed">{children}</p>
    </div>
  );
}

/* ─── Status Pill ───────────────────────────────────────────────────────── */

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[10px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] bg-gray-50 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      {label}
    </span>
  );
}

/* ─── Section Card ──────────────────────────────────────────────────────── */

function SectionCard({
  icon, iconBg, title, subtitle, badge, open, onToggle, children,
}: {
  icon: React.ReactNode; iconBg: string; title: string; subtitle: string;
  badge?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button onClick={onToggle} className="flex items-center justify-between w-full px-5 py-4 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
              {badge}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </section>
  );
}

/* ─── Outlet Card ───────────────────────────────────────────────────────── */

function OutletCard({
  storeId, configured, enabled, onToggle, toggling, defaultOpen, children,
}: {
  storeId: string; configured: boolean; enabled: boolean;
  onToggle: (v: boolean) => void; toggling: boolean;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const name = STORE_NAMES[storeId] ?? storeId;

  return (
    <div className={`rounded-lg border transition-colors ${enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50/50"}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
          <Store className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
          <StatusPill ok={configured} label={configured ? "Configured" : "Not set"} />
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        </button>
        <Toggle checked={enabled} onChange={onToggle} disabled={toggling} />
      </div>
      {open && <div className="px-4 pb-4 border-t border-gray-100 pt-3">{children}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function IntegrationsPage() {
  const [outlets, setOutlets] = useState<OutletSetting[]>([]);
  const [outletsLoading, setOutletsLoading] = useState(true);
  const [pgConfig, setPgConfig] = useState<PaymentGatewayConfig[]>([]);
  const [pgLoading, setPgLoading] = useState(true);
  const [pgSaving, setPgSaving] = useState<string | null>(null);

  // Section open/close
  const [paymentOpen, setPaymentOpen] = useState(true);
  const [rmOpen, setRmOpen] = useState(false);
  const [bukkuOpen, setBukkuOpen] = useState(false);

  // Per-outlet RM form state
  const [rmForms, setRmForms] = useState<Record<string, { merchant_id: string; client_id: string; client_secret: string; private_key: string; is_production: boolean }>>({});
  const [rmSaving, setRmSaving] = useState<string | null>(null);
  const [rmMsg, setRmMsg] = useState<Record<string, string>>({});

  // Per-outlet Bukku form state
  const [bukkuForms, setBukkuForms] = useState<Record<string, { token: string; subdomain: string }>>({});
  const [bukkuSaving, setBukkuSaving] = useState<string | null>(null);
  const [bukkuMsg, setBukkuMsg] = useState<Record<string, string>>({});

  const [toggling, setToggling] = useState<string | null>(null);

  /* ── Load ──────────────────────────────────────────────────────────────── */

  const loadOutlets = useCallback(async () => {
    setOutletsLoading(true);
    try {
      const res = await fetch("/api/pickup/integrations/outlets");
      const data = await res.json();
      setOutlets(data);
      const rmInit: typeof rmForms = {};
      const bukkuInit: typeof bukkuForms = {};
      (data as OutletSetting[]).forEach((o) => {
        rmInit[o.store_id] = { merchant_id: "", client_id: "", client_secret: "", private_key: "", is_production: o.rm_is_production ?? false };
        bukkuInit[o.store_id] = { token: "", subdomain: o.bukku_subdomain ?? "" };
      });
      setRmForms(rmInit);
      setBukkuForms(bukkuInit);
    } catch { /* ignore */ }
    setOutletsLoading(false);
  }, []);

  const loadPgConfig = useCallback(async () => {
    setPgLoading(true);
    try {
      const res = await fetch("/api/pickup/integrations/payment-gateway");
      const data = await res.json();
      setPgConfig(data);
    } catch { /* ignore */ }
    setPgLoading(false);
  }, []);

  useEffect(() => { loadOutlets(); loadPgConfig(); }, [loadOutlets, loadPgConfig]);

  /* ── Payment methods ───────────────────────────────────────────────────── */

  function getConfig(methodId: string): PaymentGatewayConfig {
    const def = METHOD_DEFS.find((m) => m.id === methodId);
    return pgConfig.find((c) => c.method_id === methodId) ?? { method_id: methodId, enabled: true, provider: def?.defaultProvider ?? "stripe" };
  }

  async function toggleEnabled(methodId: string, enabled: boolean) {
    setPgSaving(methodId);
    setPgConfig((prev) => {
      const exists = prev.find((c) => c.method_id === methodId);
      if (exists) return prev.map((c) => (c.method_id === methodId ? { ...c, enabled } : c));
      const def = METHOD_DEFS.find((m) => m.id === methodId);
      return [...prev, { method_id: methodId, enabled, provider: def?.defaultProvider ?? "stripe" }];
    });
    await fetch("/api/pickup/integrations/payment-gateway", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method_id: methodId, enabled }),
    });
    setPgSaving(null);
  }

  async function changeProvider(methodId: string, provider: Provider) {
    setPgSaving(methodId + "_provider");
    setPgConfig((prev) => {
      const exists = prev.find((c) => c.method_id === methodId);
      if (exists) return prev.map((c) => (c.method_id === methodId ? { ...c, provider } : c));
      return [...prev, { method_id: methodId, enabled: true, provider }];
    });
    await fetch("/api/pickup/integrations/payment-gateway", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method_id: methodId, provider }),
    });
    setPgSaving(null);
  }

  /* ── Save RM ───────────────────────────────────────────────────────────── */

  async function saveRm(storeId: string) {
    setRmSaving(storeId);
    setRmMsg((m) => ({ ...m, [storeId]: "" }));
    const form = rmForms[storeId];
    const outlet = outlets.find((o) => o.store_id === storeId)!;

    const payload = {
      merchant_id: form.merchant_id || outlet.rm_merchant_id || undefined,
      client_id: form.client_id || outlet.rm_client_id || undefined,
      client_secret: form.client_secret || outlet.rm_client_secret || undefined,
      private_key: form.private_key || outlet.rm_private_key || undefined,
      is_production: form.is_production,
    };

    const res = await fetch(`/api/pickup/integrations/outlets/${storeId}/revenue-monster`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setRmMsg((m) => ({ ...m, [storeId]: "Saved" }));
      await loadOutlets();
      setTimeout(() => setRmMsg((m) => ({ ...m, [storeId]: "" })), 2500);
    } else {
      const d = await res.json();
      setRmMsg((m) => ({ ...m, [storeId]: d.error ?? "Error saving" }));
    }
    setRmSaving(null);
  }

  /* ── Save Bukku ────────────────────────────────────────────────────────── */

  async function saveBukku(storeId: string) {
    setBukkuSaving(storeId);
    setBukkuMsg((m) => ({ ...m, [storeId]: "" }));
    const form = bukkuForms[storeId];
    const outlet = outlets.find((o) => o.store_id === storeId)!;

    const payload = {
      token: form.token || outlet.bukku_token || undefined,
      subdomain: form.subdomain || outlet.bukku_subdomain || undefined,
    };

    const res = await fetch(`/api/pickup/integrations/outlets/${storeId}/bukku`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setBukkuMsg((m) => ({ ...m, [storeId]: "Saved" }));
      await loadOutlets();
      setTimeout(() => setBukkuMsg((m) => ({ ...m, [storeId]: "" })), 2500);
    } else {
      const d = await res.json();
      setBukkuMsg((m) => ({ ...m, [storeId]: d.error ?? "Error saving" }));
    }
    setBukkuSaving(null);
  }

  /* ── Toggle integration per outlet ────────────────────────────────────── */

  async function toggleIntegration(storeId: string, field: "rm_enabled" | "bukku_enabled" | "stripe_enabled", value: boolean) {
    setToggling(`${storeId}_${field}`);
    setOutlets((prev) => prev.map((o) => (o.store_id === storeId ? { ...o, [field]: value } : o)));
    await fetch("/api/pickup/integrations/outlets", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, field, value }),
    });
    setToggling(null);
  }

  /* ── Computed stats ────────────────────────────────────────────────────── */

  const enabledMethods = METHOD_DEFS.filter((m) => getConfig(m.id).enabled).length;
  const rmConfiguredCount = outlets.filter(isRmConfigured).length;
  const bukkuConfiguredCount = outlets.filter(isBukkuConfigured).length;

  /* ─── Render ─────────────────────────────────────────────────────────── */

  if (outletsLoading && pgLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Integrations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Payment gateways, accounting, and connected services</p>
        </div>
        <button
          onClick={() => { loadOutlets(); loadPgConfig(); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors rounded-lg px-3 py-1.5 hover:bg-gray-100"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${outletsLoading || pgLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Status Overview ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Payment Methods", value: `${enabledMethods}/${METHOD_DEFS.length}`, sub: "active", color: "bg-terracotta/10 text-terracotta" },
          { label: "Revenue Monster", value: `${rmConfiguredCount}/${outlets.length}`, sub: "outlets", color: "bg-blue-50 text-blue-600" },
          { label: "Bukku", value: `${bukkuConfiguredCount}/${outlets.length}`, sub: "outlets", color: "bg-purple-50 text-purple-600" },
          { label: "StoreHub", value: "Active", sub: "syncing", color: "bg-green-50 text-green-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-3.5">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{s.label}</p>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-lg font-bold text-gray-900">{s.value}</span>
              <span className="text-xs text-gray-400">{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Payment Methods ─────────────────────────────────────────────── */}
      <SectionCard
        icon={<Wallet className="h-5 w-5 text-terracotta" />}
        iconBg="bg-terracotta/10"
        title="Payment Methods"
        subtitle="Enable methods and choose which gateway processes each one"
        badge={<span className="text-[10px] bg-terracotta/10 text-terracotta px-2 py-0.5 rounded-full font-medium">{enabledMethods} active</span>}
        open={paymentOpen}
        onToggle={() => setPaymentOpen(!paymentOpen)}
      >
        <div className="mt-4 space-y-4">
          {/* Provider legend */}
          <div className="flex gap-4">
            {PROVIDERS.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className={`w-2.5 h-2.5 rounded-full ${p.dot}`} />
                {p.label}
              </div>
            ))}
          </div>

          {/* Method rows */}
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {METHOD_DEFS.map((method) => {
              const cfg = getConfig(method.id);
              const saving = pgSaving === method.id || pgSaving === method.id + "_provider";
              return (
                <div key={method.id} className={`flex items-center justify-between px-4 py-3 transition-colors ${cfg.enabled ? "bg-white" : "bg-gray-50/50"}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Toggle
                      checked={cfg.enabled}
                      onChange={(v) => toggleEnabled(method.id, v)}
                      disabled={saving}
                    />
                    <span className="text-base mr-1">{method.icon}</span>
                    <span className={`text-sm font-medium transition-colors ${cfg.enabled ? "text-gray-900" : "text-gray-400"}`}>{method.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {method.providers.length > 1 ? (
                      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {method.providers.map((p) => {
                          const active = cfg.provider === p;
                          const prov = PROVIDERS.find((pr) => pr.id === p)!;
                          return (
                            <button
                              key={p}
                              onClick={() => changeProvider(method.id, p)}
                              disabled={saving}
                              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                active
                                  ? "bg-gray-900 text-white"
                                  : "bg-white text-gray-500 hover:bg-gray-50"
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white" : prov.dot}`} />
                              {prov.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium px-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${PROVIDERS.find((p) => p.id === method.providers[0])?.dot}`} />
                        {PROVIDERS.find((p) => p.id === method.providers[0])?.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* ── Revenue Monster (per outlet) ───────────────────────────────── */}
      <SectionCard
        icon={<Zap className="h-5 w-5 text-blue-600" />}
        iconBg="bg-blue-50"
        title="Revenue Monster"
        subtitle="Per-outlet merchant credentials for payment processing"
        badge={<StatusPill ok={rmConfiguredCount === outlets.length} label={`${rmConfiguredCount}/${outlets.length} configured`} />}
        open={rmOpen}
        onToggle={() => setRmOpen(!rmOpen)}
      >
        <div className="mt-4 space-y-3">
          <InfoBanner>
            Revenue Monster processes FPX, TNG, GrabPay, Boost, and credit/debit card payments.
            Each outlet needs its own merchant credentials from the Revenue Monster dashboard.
          </InfoBanner>

          <div className="space-y-2">
            {outlets.map((outlet) => (
              <OutletCard
                key={outlet.store_id}
                storeId={outlet.store_id}
                configured={isRmConfigured(outlet)}
                enabled={outlet.rm_enabled}
                onToggle={(v) => toggleIntegration(outlet.store_id, "rm_enabled", v)}
                toggling={toggling === `${outlet.store_id}_rm_enabled`}
              >
                {rmForms[outlet.store_id] && (
                  <div className="space-y-3">
                    <CredField label="Merchant ID" placeholder="Enter merchant ID" existing={outlet.rm_merchant_id} value={rmForms[outlet.store_id].merchant_id} onChange={(v) => setRmForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], merchant_id: v } }))} />
                    <CredField label="Client ID" placeholder="Enter client ID" existing={outlet.rm_client_id} value={rmForms[outlet.store_id].client_id} onChange={(v) => setRmForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], client_id: v } }))} />
                    <CredField label="Client Secret" placeholder="Enter client secret" existing={outlet.rm_client_secret} value={rmForms[outlet.store_id].client_secret} onChange={(v) => setRmForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], client_secret: v } }))} />
                    <CredField label="Private Key" placeholder="Paste RSA private key" existing={outlet.rm_private_key} value={rmForms[outlet.store_id].private_key} onChange={(v) => setRmForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], private_key: v } }))} textarea />

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rmForms[outlet.store_id].is_production}
                          onChange={(e) => setRmForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], is_production: e.target.checked } }))}
                          className="rounded border-gray-300"
                        />
                        <span className="text-gray-600">Production mode</span>
                      </label>
                      <div className="flex items-center gap-2">
                        {rmMsg[outlet.store_id] && (
                          <span className={`text-xs font-medium flex items-center gap-1 ${rmMsg[outlet.store_id] === "Saved" ? "text-green-600" : "text-red-500"}`}>
                            {rmMsg[outlet.store_id] === "Saved" && <CheckCircle2 className="h-3 w-3" />}
                            {rmMsg[outlet.store_id]}
                          </span>
                        )}
                        <button
                          onClick={() => saveRm(outlet.store_id)}
                          disabled={rmSaving === outlet.store_id}
                          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {rmSaving === outlet.store_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Save Credentials
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </OutletCard>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── Bukku Accounting (per outlet) ──────────────────────────────── */}
      <SectionCard
        icon={<BookOpen className="h-5 w-5 text-purple-600" />}
        iconBg="bg-purple-50"
        title="Bukku Accounting"
        subtitle="Automated invoicing for pickup orders and inventory purchases"
        badge={<StatusPill ok={bukkuConfiguredCount === outlets.length} label={`${bukkuConfiguredCount}/${outlets.length} configured`} />}
        open={bukkuOpen}
        onToggle={() => setBukkuOpen(!bukkuOpen)}
      >
        <div className="mt-4 space-y-3">
          <InfoBanner>
            Bukku syncs with both <strong>Pickup</strong> (auto-creates sales invoices when orders are completed)
            and <strong>Procurement</strong> (links supplier purchase orders to accounting).
            Each outlet has its own Bukku subdomain and API token.
          </InfoBanner>

          <div className="space-y-2">
            {outlets.map((outlet) => (
              <OutletCard
                key={outlet.store_id}
                storeId={outlet.store_id}
                configured={isBukkuConfigured(outlet)}
                enabled={outlet.bukku_enabled}
                onToggle={(v) => toggleIntegration(outlet.store_id, "bukku_enabled", v)}
                toggling={toggling === `${outlet.store_id}_bukku_enabled`}
              >
                {bukkuForms[outlet.store_id] && (
                  <div className="space-y-3">
                    <CredField label="API Token" placeholder="Enter Bukku API token" existing={outlet.bukku_token} value={bukkuForms[outlet.store_id].token} onChange={(v) => setBukkuForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], token: v } }))} />
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1.5 block">Subdomain</label>
                      <div className="flex items-center gap-0">
                        <input
                          type="text"
                          placeholder={outlet.bukku_subdomain || "e.g. celsius-shah-alam"}
                          value={bukkuForms[outlet.store_id].subdomain}
                          onChange={(e) => setBukkuForms((f) => ({ ...f, [outlet.store_id]: { ...f[outlet.store_id], subdomain: e.target.value } }))}
                          className="flex-1 text-xs border border-gray-200 rounded-l-lg px-3 py-2 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-terracotta/20 focus:border-terracotta/40 transition"
                        />
                        <span className="text-xs text-gray-400 border border-l-0 border-gray-200 rounded-r-lg px-3 py-2 bg-gray-100 whitespace-nowrap">.bukku.my</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      {bukkuMsg[outlet.store_id] && (
                        <span className={`text-xs font-medium flex items-center gap-1 ${bukkuMsg[outlet.store_id] === "Saved" ? "text-green-600" : "text-red-500"}`}>
                          {bukkuMsg[outlet.store_id] === "Saved" && <CheckCircle2 className="h-3 w-3" />}
                          {bukkuMsg[outlet.store_id]}
                        </span>
                      )}
                      <button
                        onClick={() => saveBukku(outlet.store_id)}
                        disabled={bukkuSaving === outlet.store_id}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
                      >
                        {bukkuSaving === outlet.store_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save Credentials
                      </button>
                    </div>
                  </div>
                )}
              </OutletCard>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── StoreHub POS ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Receipt className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-gray-900 text-sm">StoreHub POS</h2>
              <StatusPill ok={true} label="Connected" />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Source of truth for product catalog and sales data. Syncs automatically via cron.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
