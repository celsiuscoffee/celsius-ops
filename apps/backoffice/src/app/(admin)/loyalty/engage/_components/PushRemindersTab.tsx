"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, Power, TrendingUp, MailOpen, ShoppingCart, Coins, Clock,
  X, Send, Sparkles, Save, Plus, Trash2, Wand2,
} from "lucide-react";
import { toast } from "@celsius/ui";

/**
 * Push reminders tab — list + drill-in editor + custom-campaign
 * builder. Two campaign kinds:
 *   - builtin: the 5 seeded triggers. Trigger logic is hardcoded
 *     in the cron, admins can edit copy / cap / window only.
 *   - custom:  admin-defined. Trigger logic is the audience rule
 *     (any combination of supported member fields).
 */

type Stats = {
  sent7: number; sent30: number;
  opened7: number; opened30: number;
  orders7: number; orders30: number;
  revenue7: number; revenue30: number;
};

type Campaign = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  trigger_kind: "builtin" | "custom";
  is_seeded: boolean;
  trigger_config: Record<string, unknown>;
  audience_filter: AudienceFilter | null;
  frequency_cap_count: number;
  frequency_cap_days: number;
  send_window_start_hour: number;
  send_window_end_hour: number;
  enabled: boolean;
  title_template: string | null;
  body_template:  string | null;
  deeplink_path:  string | null;
  stats: Stats;
};

type AudienceCondition = {
  field: string;
  op: string;
  value?: unknown;
};
type AudienceFilter = {
  all?: AudienceCondition[];
  any?: AudienceCondition[];
};

const KEY_ICONS: Record<string, typeof Bell> = {
  voucher_expiring:  Clock,
  sitting_on_beans:  Coins,
  lapsed_customer:   TrendingUp,
  birthday_treat:    Bell,
  tier_at_risk:      MailOpen,
};

/** Per-campaign template variable surface. Built-in campaigns get a
 *  curated list (matches what the cron actually injects). Custom
 *  campaigns currently have no per-member vars — placeholder for
 *  Phase 4. */
const VARIABLE_DEFS: Record<string, { name: string; example: string | number; description: string }[]> = {
  voucher_expiring: [
    { name: "rewardName", example: "Free Cappuccino", description: "Name of the expiring voucher" },
    { name: "daysLeft",   example: 2,                 description: "Days remaining (auto-pluralised via {{daysLeftPlural}})" },
  ],
  sitting_on_beans: [
    { name: "points",    example: 250,    description: "Customer's current Points balance" },
    { name: "firstName", example: "Alia", description: "Customer's first name (may be empty)" },
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

/** Audience field whitelist — must mirror lib/push/audience.ts FIELD_DEFS.
 *  The cron evaluator validates server-side; this list drives the UI. */
const AUDIENCE_FIELD_DEFS: Array<{
  name: string;
  label: string;
  kind: "number" | "string" | "boolean";
  hint?: string;
}> = [
  { name: "points_balance",       label: "Points balance",         kind: "number" },
  { name: "days_since_last_order", label: "Days since last order", kind: "number" },
  { name: "total_lifetime_orders", label: "Lifetime orders",       kind: "number" },
  { name: "total_lifetime_spend",  label: "Lifetime spend (RM)",   kind: "number" },
  { name: "current_tier_name",    label: "Current tier",          kind: "string", hint: "Use 'in' with comma list e.g. Silver,Gold" },
  { name: "days_since_signup",    label: "Days since signup",     kind: "number" },
  { name: "days_since_birthday",  label: "Days since birthday",   kind: "number" },
  { name: "has_active_voucher",   label: "Has active voucher",    kind: "boolean" },
];

const NUMBER_OPS = [">=", "<=", ">", "<", "=", "!="];
const STRING_OPS = ["=", "!=", "in", "not_in"];
const BOOL_OPS   = ["is_true", "is_false"];

export default function PushRemindersTab() {
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busyKey, setBusyKey]       = useState<string | null>(null);
  const [windowMode, setWindowMode] = useState<"7d" | "30d">("7d");
  const [editing, setEditing]       = useState<Campaign | null>(null);
  const [creating, setCreating]     = useState(false);

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

  async function createCampaign(name: string) {
    setCreating(false);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      await load();
      // Open the editor on the new row immediately so admins land
      // straight in the rule builder rather than hunting for it.
      setEditing({ ...created, stats: { sent7:0,sent30:0,opened7:0,opened30:0,orders7:0,orders30:0,revenue7:0,revenue30:0 } });
      toast.success("Campaign created — fill in the audience rule then enable");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create campaign");
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

  const builtins = campaigns.filter((c) => c.trigger_kind === "builtin");
  const customs  = campaigns.filter((c) => c.trigger_kind === "custom");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-600 max-w-2xl">
          Triggered push notifications fan out daily. Click a row to edit copy and audience.
          Built-in campaigns ship with the app; custom ones you build yourself.
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white text-xs">
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
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Sent"      value={totals.sent.toLocaleString()} />
        <StatBox label="Open rate" value={`${openRate.toFixed(1)}%`}    sub={`${totals.opened.toLocaleString()} opened`} />
        <StatBox label="Orders"    value={totals.orders.toLocaleString()} sub={`${orderRate.toFixed(1)}% of sent`} />
        <StatBox label="Revenue"   value={`RM${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} highlight />
      </div>

      <CampaignList title="Built-in" subtitle="Hardcoded triggers — edit copy + cap, cannot delete" campaigns={builtins} loading={loading} windowMode={windowMode} busyKey={busyKey} onClickRow={setEditing} onToggle={toggle} />
      <CampaignList title="Custom"   subtitle="Your own audience rules + copy" campaigns={customs} loading={loading} windowMode={windowMode} busyKey={busyKey} onClickRow={setEditing} onToggle={toggle} emptyHint="No custom campaigns yet — click + New campaign above to start." />

      <p className="text-xs text-gray-400 text-center">
        Stats include only sends from active campaigns within the selected window.
        Order attribution = last-touch within 24h.
      </p>

      {creating && (
        <NewCampaignDialog onClose={() => setCreating(false)} onCreate={createCampaign} />
      )}
      {editing && (
        <CampaignEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
          onDeleted={async () => { await load(); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ── List section ─────────────────────────────────────────── */

function CampaignList({ title, subtitle, campaigns, loading, windowMode, busyKey, onClickRow, onToggle, emptyHint }: {
  title: string;
  subtitle: string;
  campaigns: Campaign[];
  loading: boolean;
  windowMode: "7d" | "30d";
  busyKey: string | null;
  onClickRow: (c: Campaign) => void;
  onToggle: (key: string, next: boolean) => void;
  emptyHint?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/60 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[11px] text-gray-400">{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">{emptyHint ?? "Nothing here yet."}</div>
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
                onClick={() => onClickRow(c)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center w-10">
                    <Icon className={`h-5 w-5 ${c.enabled ? "text-amber-600" : "text-gray-400"}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{c.name}</span>
                      {c.enabled ? (
                        <Pill color="green">On</Pill>
                      ) : (
                        <Pill color="gray">Paused</Pill>
                      )}
                      {c.title_template && <Pill color="amber">Custom copy</Pill>}
                      {c.trigger_kind === "custom" && <Pill color="indigo">Custom rule</Pill>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.description}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Cap {c.frequency_cap_count}/{c.frequency_cap_days}d ·
                      {" "}{String(c.send_window_start_hour).padStart(2, "0")}:00–{String(c.send_window_end_hour).padStart(2, "0")}:00 MYT
                    </p>
                  </div>

                  <div className="hidden md:grid grid-cols-4 gap-6 items-center text-right text-xs">
                    <Stat label="Sent"    value={sent.toLocaleString()} />
                    <Stat label="Opened"  value={`${open.toFixed(0)}%`}  sub={opened.toLocaleString()} />
                    <Stat label="Orders"  value={`${order.toFixed(0)}%`} sub={orders.toLocaleString()} />
                    <Stat label="Revenue" value={`RM${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} highlight />
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); onToggle(c.key, !c.enabled); }}
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── New campaign dialog ─────────────────────────────────── */

function NewCampaignDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-amber-600" />
          New custom campaign
        </h3>
        <p className="text-xs text-gray-500 mt-1">Name it. You'll add the audience rule + copy in the editor next.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. VIP morning nudge"
          className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2">Cancel</button>
          <button
            onClick={() => name.trim() && onCreate(name.trim())}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────── */

function CampaignEditor({ campaign, onClose, onSaved, onDeleted }: {
  campaign: Campaign;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle]               = useState(campaign.title_template ?? "");
  const [body, setBody]                 = useState(campaign.body_template ?? "");
  const [deeplink, setDeeplink]         = useState(campaign.deeplink_path ?? "");
  const [capCount, setCapCount]         = useState(campaign.frequency_cap_count);
  const [capDays, setCapDays]           = useState(campaign.frequency_cap_days);
  const [windowStart, setWindowStart]   = useState(campaign.send_window_start_hour);
  const [windowEnd, setWindowEnd]       = useState(campaign.send_window_end_hour);
  const [conds, setConds]               = useState<AudienceCondition[]>(
    (campaign.audience_filter?.all ?? []) as AudienceCondition[],
  );
  const [saving, setSaving]             = useState(false);
  const [deleting, setDeleting]         = useState(false);
  const [testPhone, setTestPhone]       = useState("");
  const [testSending, setTestSending]   = useState(false);

  const isCustom = campaign.trigger_kind === "custom";
  const variables = VARIABLE_DEFS[campaign.key] ?? [];

  const exampleVars = useMemo(() => {
    const v: Record<string, string | number> = {};
    for (const def of variables) v[def.name] = def.example;
    return v;
  }, [variables]);

  function renderPreview(template: string): string {
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
      const audience = isCustom ? { all: conds } : undefined;
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
          ...(audience ? { audience_filter: audience } : {}),
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

  async function deleteCampaign() {
    if (!confirm(`Delete "${campaign.name}"? Stats will go with it. This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns/${campaign.key}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Campaign deleted");
      onDeleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      toast.error(msg);
    } finally {
      setDeleting(false);
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
      <button type="button" aria-label="Close editor" onClick={onClose} className="flex-1 bg-black/30" />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{campaign.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-gray-500">{campaign.key}</span>
              {isCustom ? <Pill color="indigo">Custom</Pill> : <Pill color="gray">Built-in</Pill>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Audience rule (custom only) */}
          {isCustom && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Audience rule</p>
              <p className="text-xs text-gray-500 mb-2">
                Send to members where ALL of these match. Empty rule = nobody (safe default).
              </p>
              <div className="space-y-2">
                {conds.map((c, i) => (
                  <RuleRow
                    key={i}
                    cond={c}
                    onChange={(next) => setConds((arr) => arr.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => setConds((arr) => arr.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  onClick={() => {
                    const def = AUDIENCE_FIELD_DEFS[0];
                    setConds((arr) => [...arr, defaultCondForField(def.name)]);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 font-semibold mt-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add condition
                </button>
              </div>
            </div>
          )}

          {/* Built-in trigger info */}
          {!isCustom && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Trigger</p>
              <p className="text-xs text-gray-600">
                Built-in trigger — the cron determines who gets this. Edit copy, cap, and window below.
              </p>
            </div>
          )}

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

          {/* Cap + window */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max sends">
              <input type="number" min={0} value={capCount} onChange={(e) => setCapCount(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
            </Field>
            <Field label="Per (days)">
              <input type="number" min={1} value={capDays} onChange={(e) => setCapDays(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Send from (MYT hour)">
              <input type="number" min={0} max={23} value={windowStart} onChange={(e) => setWindowStart(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
            </Field>
            <Field label="Until (MYT hour)">
              <input type="number" min={1} max={24} value={windowEnd} onChange={(e) => setWindowEnd(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
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
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+60 12 345 6789"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
              <button onClick={sendTest} disabled={testSending || !testPhone || !title || !body}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-40">
                <Send className="h-3.5 w-3.5" />
                {testSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>

          {/* Delete (custom only) */}
          {isCustom && (
            <div className="border-t border-gray-200 pt-5">
              <button onClick={deleteCampaign} disabled={deleting}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800">
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? "Deleting…" : "Delete this campaign"}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Rule row ─────────────────────────────────────────────── */

function defaultCondForField(field: string): AudienceCondition {
  const def = AUDIENCE_FIELD_DEFS.find((d) => d.name === field) ?? AUDIENCE_FIELD_DEFS[0];
  if (def.kind === "boolean") return { field, op: "is_true" };
  if (def.kind === "string")  return { field, op: "=", value: "" };
  return { field, op: ">=", value: 0 };
}

function RuleRow({ cond, onChange, onRemove }: {
  cond: AudienceCondition;
  onChange: (next: AudienceCondition) => void;
  onRemove: () => void;
}) {
  const def = AUDIENCE_FIELD_DEFS.find((d) => d.name === cond.field) ?? AUDIENCE_FIELD_DEFS[0];
  const ops = def.kind === "boolean" ? BOOL_OPS : def.kind === "string" ? STRING_OPS : NUMBER_OPS;

  function setField(field: string) {
    onChange(defaultCondForField(field));
  }

  function setOp(op: string) {
    // When switching ops on a string field between '=' and 'in', the
    // value shape changes (single → array). Reset to a sensible
    // default so the input always matches the operator.
    let value = cond.value;
    if (def.kind === "string" && (op === "in" || op === "not_in") && !Array.isArray(value)) value = [];
    if (def.kind === "string" && (op === "=" || op === "!=") && Array.isArray(value)) value = "";
    onChange({ ...cond, op, value });
  }

  function setValue(v: unknown) {
    onChange({ ...cond, value: v });
  }

  const showsValue = def.kind !== "boolean";
  const isList = (cond.op === "in" || cond.op === "not_in");

  return (
    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-2">
      <select
        value={cond.field}
        onChange={(e) => setField(e.target.value)}
        className="text-xs bg-white border border-gray-200 rounded px-2 py-1.5 focus:border-amber-400 focus:outline-none flex-1 min-w-0"
      >
        {AUDIENCE_FIELD_DEFS.map((d) => (
          <option key={d.name} value={d.name}>{d.label}</option>
        ))}
      </select>
      <select
        value={cond.op}
        onChange={(e) => setOp(e.target.value)}
        className="text-xs bg-white border border-gray-200 rounded px-2 py-1.5 focus:border-amber-400 focus:outline-none"
      >
        {ops.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {showsValue && (
        <input
          type={def.kind === "number" ? "number" : "text"}
          value={isList && Array.isArray(cond.value) ? (cond.value as string[]).join(", ") : (cond.value as string | number | undefined ?? "").toString()}
          onChange={(e) => {
            const raw = e.target.value;
            if (isList) setValue(raw.split(",").map((s) => s.trim()).filter(Boolean));
            else if (def.kind === "number") setValue(raw === "" ? "" : Number(raw));
            else setValue(raw);
          }}
          placeholder={def.hint ?? (isList ? "Silver, Gold" : "")}
          className="text-xs bg-white border border-gray-200 rounded px-2 py-1.5 focus:border-amber-400 focus:outline-none w-28"
        />
      )}
      <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove condition">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── Small helpers ────────────────────────────────────────── */

function Pill({ color, children }: { color: "green" | "gray" | "amber" | "indigo"; children: React.ReactNode }) {
  const c = {
    green:  "bg-green-100 text-green-700",
    gray:   "bg-gray-100 text-gray-500",
    amber:  "bg-amber-50 text-amber-700",
    indigo: "bg-indigo-50 text-indigo-700",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${c}`}>
      {color === "green" && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      {children}
    </span>
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
