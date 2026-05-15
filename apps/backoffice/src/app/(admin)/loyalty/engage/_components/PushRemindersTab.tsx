"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Power, TrendingUp, MailOpen, ShoppingCart, Coins, Clock, X, Send, Sparkles, Save } from "lucide-react";
import { toast } from "@celsius/ui";

/**
 * Push reminders tab. List view + drill-in editor in a single
 * component so the panel slides over the list rather than a
 * separate route — matches the rest of /loyalty editing patterns.
 *
 * Editor surfaces:
 *   - Title + body templates with {{variable}} interpolation
 *   - Variable chips (campaign-specific) admins can paste in
 *   - Live preview rendered with example var values
 *   - Test-send: type a phone, fire the rendered draft to that device
 *   - Frequency cap + send window editing
 */

type Campaign = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  trigger_config: Record<string, unknown>;
  frequency_cap_count: number;
  frequency_cap_days: number;
  send_window_start_hour: number;
  send_window_end_hour: number;
  enabled: boolean;
  title_template: string | null;
  body_template:  string | null;
  deeplink_path:  string | null;
  stats: {
    sent7: number;
    sent30: number;
    opened7: number;
    opened30: number;
    orders7: number;
    orders30: number;
    revenue7: number;
    revenue30: number;
  };
};

const KEY_ICONS: Record<string, typeof Bell> = {
  voucher_expiring:  Clock,
  sitting_on_beans:  Coins,
  lapsed_customer:   TrendingUp,
  birthday_treat:    Bell,
  tier_at_risk:      MailOpen,
};

/** Per-campaign variable surface — what {{vars}} the renderer makes
 *  available for that trigger, plus example values for the live
 *  preview. Keeps admins out of the cron source code. */
const VARIABLE_DEFS: Record<string, { name: string; example: string | number; description: string }[]> = {
  voucher_expiring: [
    { name: "rewardName", example: "Free Cappuccino", description: "Name of the expiring voucher" },
    { name: "daysLeft",   example: 2,                 description: "Days remaining (auto-pluralised via {{daysLeftPlural}})" },
  ],
  sitting_on_beans: [
    { name: "points",    example: 250,         description: "Customer's current Beans balance" },
    { name: "firstName", example: "Alia",      description: "Customer's first name (may be empty)" },
  ],
  lapsed_customer: [
    { name: "firstName", example: "Alia", description: "Customer's first name (may be empty)" },
  ],
  birthday_treat: [
    { name: "firstName", example: "Alia", description: "Customer's first name (may be empty)" },
  ],
  tier_at_risk: [
    { name: "currentTier", example: "Gold", description: "Tier the customer is about to lose" },
    { name: "cupsShort",   example: 2,      description: "Cups still needed (auto-pluralised)" },
    { name: "daysLeft",    example: 14,     description: "Days remaining in trailing window" },
  ],
};

export default function PushRemindersTab() {
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busyKey, setBusyKey]       = useState<string | null>(null);
  const [windowMode, setWindowMode] = useState<"7d" | "30d">("7d");
  const [editing, setEditing]       = useState<Campaign | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/push-campaigns");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setCampaigns(json.campaigns ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: string, next: boolean) {
    setBusyKey(key);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
      toast.success(next ? "Campaign enabled" : "Campaign paused");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update campaign");
    } finally {
      setBusyKey(null);
    }
  }

  const totals = useMemo(() => {
    return campaigns
      .filter((c) => c.enabled)
      .reduce(
        (acc, c) => {
          acc.sent    += windowMode === "7d" ? c.stats.sent7    : c.stats.sent30;
          acc.opened  += windowMode === "7d" ? c.stats.opened7  : c.stats.opened30;
          acc.orders  += windowMode === "7d" ? c.stats.orders7  : c.stats.orders30;
          acc.revenue += windowMode === "7d" ? c.stats.revenue7 : c.stats.revenue30;
          return acc;
        },
        { sent: 0, opened: 0, orders: 0, revenue: 0 },
      );
  }, [campaigns, windowMode]);

  const openRate  = totals.sent > 0 ? (totals.opened / totals.sent) * 100 : 0;
  const orderRate = totals.sent > 0 ? (totals.orders / totals.sent) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 max-w-2xl">
          Triggered push notifications fan out daily based on each member&apos;s rewards state.
          Click a row to edit copy, frequency, and send window.
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white text-xs shrink-0">
          <button
            onClick={() => setWindowMode("7d")}
            className={`px-3 py-1.5 rounded-md transition ${
              windowMode === "7d" ? "bg-amber-100 text-amber-900 font-semibold" : "text-gray-600"
            }`}
          >Last 7 days</button>
          <button
            onClick={() => setWindowMode("30d")}
            className={`px-3 py-1.5 rounded-md transition ${
              windowMode === "30d" ? "bg-amber-100 text-amber-900 font-semibold" : "text-gray-600"
            }`}
          >Last 30 days</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Sent"      value={totals.sent.toLocaleString()} />
        <StatBox label="Open rate" value={`${openRate.toFixed(1)}%`}    sub={`${totals.opened.toLocaleString()} opened`} />
        <StatBox label="Orders"    value={totals.orders.toLocaleString()} sub={`${orderRate.toFixed(1)}% of sent`} />
        <StatBox label="Revenue"   value={`RM${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} highlight />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Campaigns</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No campaigns configured.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {campaigns.map((c) => {
              const Icon = KEY_ICONS[c.key] ?? Bell;
              const sent    = windowMode === "7d" ? c.stats.sent7    : c.stats.sent30;
              const opened  = windowMode === "7d" ? c.stats.opened7  : c.stats.opened30;
              const orders  = windowMode === "7d" ? c.stats.orders7  : c.stats.orders30;
              const revenue = windowMode === "7d" ? c.stats.revenue7 : c.stats.revenue30;
              const open    = sent > 0 ? (opened / sent) * 100 : 0;
              const order   = sent > 0 ? (orders / sent) * 100 : 0;

              return (
                <li
                  key={c.key}
                  className="px-5 py-4 hover:bg-amber-50/30 transition cursor-pointer"
                  onClick={() => setEditing(c)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center w-10">
                      <Icon className={`h-5 w-5 ${c.enabled ? "text-amber-600" : "text-gray-400"}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{c.name}</span>
                        {c.enabled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium uppercase tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            On
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium uppercase tracking-wide">
                            Paused
                          </span>
                        )}
                        {c.title_template && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium uppercase tracking-wide">
                            Custom copy
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.description}</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Cap {c.frequency_cap_count}/{c.frequency_cap_days}d &middot;
                        {" "}Send window {String(c.send_window_start_hour).padStart(2, "0")}:00 – {String(c.send_window_end_hour).padStart(2, "0")}:00 MYT
                      </p>
                    </div>

                    <div className="hidden md:grid grid-cols-4 gap-6 items-center text-right text-xs">
                      <Stat label="Sent"    value={sent.toLocaleString()} />
                      <Stat label="Opened"  value={`${open.toFixed(0)}%`}  sub={opened.toLocaleString()} />
                      <Stat label="Orders"  value={`${order.toFixed(0)}%`} sub={orders.toLocaleString()} />
                      <Stat label="Revenue" value={`RM${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} highlight />
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(c.key, !c.enabled); }}
                      disabled={busyKey === c.key}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        c.enabled
                          ? "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200"
                      } ${busyKey === c.key ? "opacity-60 cursor-wait" : ""}`}
                      aria-pressed={c.enabled}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {c.enabled ? "Pause" : "Enable"}
                    </button>
                  </div>

                  <div className="md:hidden mt-3 grid grid-cols-4 gap-3 text-xs">
                    <Stat label="Sent"    value={sent.toLocaleString()} />
                    <Stat label="Opened"  value={`${open.toFixed(0)}%`} />
                    <Stat label="Orders"  value={orders.toLocaleString()} />
                    <Stat label="Revenue" value={`RM${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} highlight />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Stats include only sends from active campaigns within the selected window.
        Order attribution = last-touch within 24h.
      </p>

      {/* Drill-in editor */}
      {editing && (
        <CampaignEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────── */

function CampaignEditor({ campaign, onClose, onSaved }: {
  campaign: Campaign;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle]               = useState(campaign.title_template ?? "");
  const [body, setBody]                 = useState(campaign.body_template ?? "");
  const [deeplink, setDeeplink]         = useState(campaign.deeplink_path ?? "");
  const [capCount, setCapCount]         = useState(campaign.frequency_cap_count);
  const [capDays, setCapDays]           = useState(campaign.frequency_cap_days);
  const [windowStart, setWindowStart]   = useState(campaign.send_window_start_hour);
  const [windowEnd, setWindowEnd]       = useState(campaign.send_window_end_hour);
  const [saving, setSaving]             = useState(false);
  const [testPhone, setTestPhone]       = useState("");
  const [testSending, setTestSending]   = useState(false);

  const variables = VARIABLE_DEFS[campaign.key] ?? [];

  // Build the example vars map for live preview from the variable
  // defs. Lets admins see "Your Free Cappuccino expires in 2 days"
  // as they type instead of "Your {{rewardName}} expires in {{daysLeft}}".
  const exampleVars = useMemo(() => {
    const v: Record<string, string | number> = {};
    for (const def of variables) v[def.name] = def.example;
    return v;
  }, [variables]);

  function renderPreview(template: string): string {
    // Lightweight client-side mirror of lib/push/render.ts. Plurals
    // included so the preview matches what the cron would actually
    // send.
    const enriched: Record<string, string | number> = { ...exampleVars };
    for (const [k, val] of Object.entries(exampleVars)) {
      if (k.endsWith("Plural")) continue;
      const n = typeof val === "number" ? val : (typeof val === "string" && /^-?\d+$/.test(val) ? Number(val) : null);
      if (n !== null && enriched[`${k}Plural`] === undefined) {
        enriched[`${k}Plural`] = Math.abs(n) === 1 ? "" : "s";
      }
    }
    return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, name) => {
      const v = enriched[name];
      return v === undefined || v === null ? m : String(v);
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns/${campaign.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title_template:        title,
          body_template:         body,
          deeplink_path:         deeplink,
          frequency_cap_count:   capCount,
          frequency_cap_days:    capDays,
          send_window_start_hour: windowStart,
          send_window_end_hour:   windowEnd,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Campaign saved");
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testPhone || !title || !body) return;
    setTestSending(true);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone:       testPhone,
          campaignKey: campaign.key,
          title,
          body,
          vars:        exampleVars,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Send failed");
      toast.success(`Sent to ${json.delivered} device${json.delivered === 1 ? "" : "s"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test send failed";
      toast.error(msg);
    } finally {
      setTestSending(false);
    }
  }

  function insertVar(name: string, target: "title" | "body") {
    const token = `{{${name}}}`;
    if (target === "title") setTitle((t) => t + token);
    else setBody((b) => b + token);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close editor"
        onClick={onClose}
        className="flex-1 bg-black/30"
      />
      {/* Panel */}
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{campaign.key}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Live preview */}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Preview</p>
            <div className="rounded-2xl bg-gray-900 text-white px-4 py-3 shadow-md">
              <p className="text-[10px] opacity-60 uppercase tracking-wider">Celsius Coffee · now</p>
              <p className="font-semibold text-sm mt-1">{renderPreview(title) || <span className="opacity-40">Title…</span>}</p>
              <p className="text-xs mt-0.5 opacity-90 leading-relaxed">{renderPreview(body) || <span className="opacity-40">Body…</span>}</p>
            </div>
          </div>

          {/* Title */}
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              placeholder="e.g. Don't let this slip away"
            />
            {variables.length > 0 && (
              <VarChips vars={variables} onPick={(v) => insertVar(v, "title")} />
            )}
          </Field>

          {/* Body */}
          <Field label="Body">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none resize-none"
              placeholder="e.g. Your {{rewardName}} expires in {{daysLeft}} day{{daysLeftPlural}}"
            />
            {variables.length > 0 && (
              <VarChips vars={variables} onPick={(v) => insertVar(v, "body")} />
            )}
          </Field>

          {/* Deep link */}
          <Field label="Tap → opens" hint="Path inside the app, e.g. rewards or rewards/vouchers">
            <input
              value={deeplink}
              onChange={(e) => setDeeplink(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              placeholder="rewards"
            />
          </Field>

          {/* Frequency cap */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max sends">
              <input
                type="number"
                min={0}
                value={capCount}
                onChange={(e) => setCapCount(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
            </Field>
            <Field label="Per (days)">
              <input
                type="number"
                min={1}
                value={capDays}
                onChange={(e) => setCapDays(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
            </Field>
          </div>

          {/* Send window */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Send from (MYT hour)">
              <input
                type="number"
                min={0}
                max={23}
                value={windowStart}
                onChange={(e) => setWindowStart(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
            </Field>
            <Field label="Until (MYT hour)">
              <input
                type="number"
                min={1}
                max={24}
                value={windowEnd}
                onChange={(e) => setWindowEnd(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
            </Field>
          </div>

          {/* Test send */}
          <div className="border-t border-gray-200 pt-5">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Test send
            </p>
            <p className="text-xs text-gray-500 mb-2">
              Send the current draft to one phone. Bypasses cap + opt-out so you can preview on your device.
            </p>
            <div className="flex gap-2">
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+60 12 345 6789"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
              <button
                onClick={sendTest}
                disabled={testSending || !testPhone || !title || !body}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                {testSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
        {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function VarChips({ vars, onPick }: { vars: { name: string; example: string | number; description: string }[]; onPick: (name: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {vars.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => onPick(v.name)}
          title={v.description}
          className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 font-mono"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
    </div>
  );
}

function StatBox({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl px-4 py-3 ${highlight ? "border-amber-200 shadow-sm" : "border-gray-200"}`}>
      <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide flex items-center gap-1">
        {label === "Revenue" && <ShoppingCart className="h-3 w-3" />}
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
