"use client";

// All Rewards — unified view across every channel.
//
// Replaces the daily-driver landing for Points Shop / Challenges /
// Mystery Pool / Birthday Treats / Admin Claimables. Same template
// shape, same row layout, filter-driven channel switch. The existing
// channel pages stay accessible from the sidebar during the transition;
// once trigger consolidation lands (Commit 4 of the rewards refactor
// spec), this becomes the only Rewards landing.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Filter, MoreHorizontal, Download, AlertCircle,
  Coins, Target, Gift, Cake, Crown, Megaphone, Hand, Ticket, Sparkles,
  Coffee, Percent, Tag, Pencil, Copy, PauseCircle, PlayCircle, Trash2,
} from "lucide-react";
import type { RewardRow, TriggerType } from "@/app/api/loyalty/all-rewards/route";

const BRAND_ID = "brand-celsius";

// ─── Static option lists ────────────────────────────────────────

const TRIGGER_META: Record<TriggerType, { label: string; icon: typeof Coins; className: string }> = {
  points_shop:   { label: "Bean Shop",     icon: Coins,     className: "bg-amber-50  text-amber-700  border-amber-200" },
  mission:       { label: "Challenges",    icon: Target,    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  mystery:       { label: "Mystery",       icon: Gift,      className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  birthday:      { label: "Birthday",      icon: Cake,      className: "bg-pink-50   text-pink-700   border-pink-200" },
  tier_upgrade:  { label: "Tier Upgrade",  icon: Crown,     className: "bg-orange-50 text-orange-700 border-orange-200" },
  admin_push:    { label: "Admin Push",    icon: Megaphone, className: "bg-rose-50   text-rose-700   border-rose-200" },
  manual_grant:  { label: "Manual",        icon: Hand,      className: "bg-slate-50  text-slate-600  border-slate-200" },
};

const DISCOUNT_META: Record<string, { label: string; className: string }> = {
  flat:              { label: "Flat — RM off",       className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  percent:           { label: "Percent",             className: "bg-orange-50  text-orange-700  border-orange-200" },
  free_item:         { label: "Free item",           className: "bg-amber-50   text-amber-800   border-amber-200" },
  free_upgrade:      { label: "Free upgrade",        className: "bg-amber-50   text-amber-800   border-amber-200" },
  bogo:              { label: "BOGO",                className: "bg-yellow-50  text-yellow-700  border-yellow-200" },
  combo:             { label: "Combo",               className: "bg-yellow-50  text-yellow-700  border-yellow-200" },
  override_price:    { label: "Override price",      className: "bg-rose-50    text-rose-700    border-rose-200" },
  beans_multiplier:  { label: "Beans ×",             className: "bg-purple-50  text-purple-700  border-purple-200" },
  none:              { label: "—",                   className: "bg-slate-50   text-slate-600   border-slate-200" },
};

const TRIGGER_ORDER: TriggerType[] = [
  "points_shop", "mission", "mystery", "birthday", "tier_upgrade", "admin_push", "manual_grant",
];
const DISCOUNT_ORDER = [
  "flat", "percent", "free_item", "free_upgrade", "bogo", "combo", "override_price", "beans_multiplier",
];

const STATUS_OPTIONS = [
  { key: "active",        label: "Active" },
  { key: "paused",        label: "Paused" },
  { key: "expiring",      label: "Expiring < 14d" },
  { key: "never_issued",  label: "Never issued" },
] as const;
type StatusKey = typeof STATUS_OPTIONS[number]["key"];

const SORT_OPTIONS = [
  { key: "updated",          label: "Recently updated" },
  { key: "name",             label: "Name A→Z" },
  { key: "issued_desc",      label: "Most issued (30d)" },
  { key: "used_desc",        label: "Most redeemed (30d)" },
  { key: "redemption_pct",   label: "Lowest redemption rate" },
] as const;
type SortKey = typeof SORT_OPTIONS[number]["key"];

// ─── Helpers ────────────────────────────────────────────────────

function formatDiscount(r: RewardRow): string {
  const dt = r.discount_type;
  const v  = r.discount_value;
  const min = r.min_order_value;
  const bits: string[] = [];
  if (dt === "flat" && v != null) bits.push(`flat · ${v}¢`);
  else if (dt === "percent" && v != null) bits.push(`percent · ${v}%`);
  else if (dt === "free_item")    bits.push("free_item");
  else if (dt === "free_upgrade") bits.push("free_upgrade");
  else if (dt === "bogo")         bits.push(`bogo · ${r.bogo_buy_qty ?? 1}+${r.bogo_free_qty ?? 1}`);
  else if (dt === "combo")        bits.push("combo");
  else if (dt === "override_price") bits.push("override_price");
  else if (dt === "beans_multiplier" && r.multiplier_value != null) bits.push(`beans × ${r.multiplier_value}`);
  else                            bits.push(dt ?? "—");
  if (min != null) bits.push(`min ${min}¢`);
  return bits.join(" · ");
}

function formatEligibility(r: RewardRow): string {
  if (r.scope === "everything") return "Everything";
  if (r.scope === "categories") {
    if (r.target_ids.length === 0) return "—";
    if (r.target_ids.length <= 2) return r.target_ids.join(", ");
    return `${r.target_ids.length} categories`;
  }
  if (r.scope === "products") {
    if (r.target_ids.length === 0) return "—";
    return `${r.target_ids.length} product${r.target_ids.length === 1 ? "" : "s"}`;
  }
  return "—";
}

function pickRewardIcon(r: RewardRow) {
  const t = (r.title || "").toLowerCase();
  if (t.includes("drink") || t.includes("coffee")) return Coffee;
  if (t.includes("cake")) return Cake;
  if (t.includes("croissant") || t.includes("pastry") || t.includes("sandwich")) return Cake;
  if (t.includes("rm") || /\d/.test(t)) return Percent;
  if (t.includes("beans") || t.includes("boost")) return Sparkles;
  if (t.includes("upgrade") || t.includes("add-on") || t.includes("addon")) return Tag;
  return Ticket;
}

// ─── Page ───────────────────────────────────────────────────────

export default function AllRewardsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filter state
  const [search, setSearch]               = useState("");
  const [triggerFilter, setTriggerFilter] = useState<Set<TriggerType>>(new Set());
  const [dtFilter, setDtFilter]           = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter]   = useState<Set<StatusKey>>(new Set());
  const [sort, setSort]                   = useState<SortKey>("updated");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/loyalty/all-rewards?brand_id=${BRAND_ID}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 120)}`);
      }
      const json = await res.json();
      setRows(json.rows ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load rewards");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ─── Row actions ─────────────────────────────────────────────
  function onRowClick(r: RewardRow) {
    // Catalog rows (legacy `rewards` table) keep their existing
    // Points Shop editor until the merge ships. Template rows go to
    // the unified editor.
    if (r.origin === "catalog") {
      router.push("/loyalty/rewards");
    } else {
      router.push(`/loyalty/all-rewards/${r.id}`);
    }
  }

  async function togglePause(r: RewardRow) {
    if (r.origin === "catalog") {
      alert("Pause for legacy catalog rows — please use the Points Shop page until the catalog merge ships.");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/loyalty/all-rewards?id=${r.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !r.is_active }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null); setActionsOpen(null);
    }
  }

  async function archive(r: RewardRow) {
    if (!confirm(`Archive "${r.title}"? It will be paused and hidden from active filters. Existing issued vouchers remain valid.`)) return;
    if (r.origin === "catalog") {
      alert("Archive for legacy catalog rows — please use the Points Shop page until the catalog merge ships.");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/loyalty/all-rewards?id=${r.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null); setActionsOpen(null);
    }
  }

  // Close action menu on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [actionsOpen]);

  // ─── Per-filter counts (compute on full set, not the filtered subset) ─
  const counts = useMemo(() => {
    const trig: Record<string, number> = {};
    const dt:   Record<string, number> = {};
    let active = 0, paused = 0, neverIssued = 0, expiring = 0;
    const now = Date.now();
    for (const r of rows) {
      if (r.is_active) active++; else paused++;
      if (r.issued_30d === 0) neverIssued++;
      if (r.expires_days != null && r.expires_days < 14) expiring++;
      if (r.discount_type) dt[r.discount_type] = (dt[r.discount_type] ?? 0) + 1;
      for (const t of r.triggers) trig[t.type] = (trig[t.type] ?? 0) + 1;
    }
    return {
      trig,
      dt,
      status: { active, paused, never_issued: neverIssued, expiring },
      total: rows.length,
    };
  }, [rows]);

  // ─── Filtered + sorted rows ───────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (q) {
        const hit =
          r.title.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (triggerFilter.size > 0) {
        const has = r.triggers.some((t) => triggerFilter.has(t.type));
        if (!has) return false;
      }
      if (dtFilter.size > 0) {
        if (!r.discount_type || !dtFilter.has(r.discount_type)) return false;
      }
      if (statusFilter.size > 0) {
        const matchesAny = Array.from(statusFilter).some((s) => {
          if (s === "active")       return r.is_active;
          if (s === "paused")       return !r.is_active;
          if (s === "never_issued") return r.issued_30d === 0;
          if (s === "expiring")     return r.expires_days != null && r.expires_days < 14;
          return false;
        });
        if (!matchesAny) return false;
      }
      return true;
    });
    out = out.slice().sort((a, b) => {
      switch (sort) {
        case "name":           return a.title.localeCompare(b.title);
        case "issued_desc":    return b.issued_30d - a.issued_30d;
        case "used_desc":      return b.used_30d - a.used_30d;
        case "redemption_pct": {
          const ra = a.issued_30d > 0 ? a.used_30d / a.issued_30d : 999;
          const rb = b.issued_30d > 0 ? b.used_30d / b.issued_30d : 999;
          return ra - rb;
        }
        case "updated":
        default:
          return b.updated_at.localeCompare(a.updated_at);
      }
    });
    return out;
  }, [rows, search, triggerFilter, dtFilter, statusFilter, sort]);

  // ─── Pill helpers ─────────────────────────────────────────────
  function toggleTrigger(t: TriggerType) {
    const next = new Set(triggerFilter); next.has(t) ? next.delete(t) : next.add(t); setTriggerFilter(next);
  }
  function toggleDt(t: string) {
    const next = new Set(dtFilter); next.has(t) ? next.delete(t) : next.add(t); setDtFilter(next);
  }
  function toggleStatus(t: StatusKey) {
    const next = new Set(statusFilter); next.has(t) ? next.delete(t) : next.add(t); setStatusFilter(next);
  }
  function clearAll() {
    setSearch(""); setTriggerFilter(new Set()); setDtFilter(new Set()); setStatusFilter(new Set());
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rewards</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every reward template across every channel. One template, many triggers.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
            <Download className="w-4 h-4" /> Export
          </button>
          <Link href="/loyalty/all-rewards/new" className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800">
            <Plus className="w-4 h-4" /> New Reward
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 my-4">
        <Stat n={counts.total}                  label="Total Rewards" />
        <Stat n={counts.status.active}          label="Active" />
        <Stat n={counts.status.paused}          label="Paused" dim />
        <Stat n={rows.reduce((s, r) => s + r.issued_30d, 0)} label="Issued (30d)" />
        <Stat n={`${
          (() => {
            const i = rows.reduce((s, r) => s + r.issued_30d, 0);
            const u = rows.reduce((s, r) => s + r.used_30d, 0);
            return i > 0 ? Math.round((u / i) * 100) : 0;
          })()
        }%`} label="Redemption Rate" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 my-4 space-y-3">
        <div className="flex gap-2 items-stretch">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, description, or reward ID"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            {SORT_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {(search || triggerFilter.size > 0 || dtFilter.size > 0 || statusFilter.size > 0) && (
            <button onClick={clearAll} className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900">
              Clear filters
            </button>
          )}
        </div>

        <PillGroup
          label="Trigger"
          options={TRIGGER_ORDER.map((t) => ({
            key: t,
            label: TRIGGER_META[t].label,
            count: counts.trig[t] ?? 0,
            iconClass: TRIGGER_META[t].className,
            Icon: TRIGGER_META[t].icon,
          }))}
          active={triggerFilter}
          onToggle={(k) => toggleTrigger(k as TriggerType)}
        />
        <PillGroup
          label="Discount"
          options={DISCOUNT_ORDER.map((t) => ({
            key: t,
            label: DISCOUNT_META[t]?.label ?? t,
            count: counts.dt[t] ?? 0,
            iconClass: DISCOUNT_META[t]?.className ?? "",
          }))}
          active={dtFilter}
          onToggle={toggleDt}
        />
        <PillGroup
          label="Status"
          options={STATUS_OPTIONS.map((s) => ({
            key: s.key,
            label: s.label,
            count: counts.status[s.key] ?? 0,
            iconClass: "bg-slate-50 text-slate-700 border-slate-200",
          }))}
          active={statusFilter}
          onToggle={(k) => toggleStatus(k as StatusKey)}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-sm text-slate-500">
          Showing <strong className="text-slate-900">{visible.length}</strong> of {rows.length} · last 30d data
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
          Loading rewards…
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-700 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Couldn&apos;t load rewards</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <div className="text-slate-700 font-medium">No rewards match these filters</div>
          <button onClick={clearAll} className="mt-3 text-sm text-indigo-600 font-medium hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 w-8"></th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Reward</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Discount</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Triggers</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Eligible</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden md:table-cell">Issued · Used (30d)</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Expires</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const Icon = pickRewardIcon(r);
                const dtMeta = DISCOUNT_META[r.discount_type ?? ""] ?? { label: r.discount_type ?? "—", className: "bg-slate-50 text-slate-600 border-slate-200" };
                const redemptionPct = r.issued_30d > 0 ? Math.round((r.used_30d / r.issued_30d) * 100) : 0;
                const rowKey = `${r.origin}:${r.id}`;
                return (
                  <tr key={rowKey} className={`border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition cursor-pointer ${!r.is_active ? "opacity-55" : ""}`} onClick={() => onRowClick(r)}>
                    <td className="px-4 py-3">
                      <span className={`inline-block w-2 h-2 rounded-full ${r.is_active ? "bg-emerald-500" : "bg-slate-400"}`} title={r.is_active ? "Active" : "Paused"} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-slate-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 text-sm leading-tight">{r.title}</div>
                          {r.description && (
                            <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{r.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${dtMeta.className}`}>
                        {formatDiscount(r)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {r.triggers.length === 0 ? (
                          <span className="text-xs text-slate-400 italic">No active trigger</span>
                        ) : r.triggers.map((t, i) => {
                          const meta = TRIGGER_META[t.type];
                          const TIcon = meta.icon;
                          return (
                            <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${meta.className}`}>
                              <TIcon className="w-3 h-3" />
                              {t.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
                      {formatEligibility(r)}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="tabular-nums text-sm font-semibold text-slate-900">{r.issued_30d} · {r.used_30d}</div>
                      <div className="text-[11px] text-slate-500">{r.issued_30d > 0 ? `${redemptionPct}% redeemed` : "Never issued"}</div>
                      {r.issued_30d > 0 && (
                        <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${redemptionPct}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
                      {r.expires_days != null ? `${r.expires_days} days` : "—"}
                    </td>
                    <td className="px-2 py-3 relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActionsOpen(actionsOpen === rowKey ? null : rowKey); }}
                        disabled={busyId === r.id}
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {actionsOpen === rowKey && (
                        <div className="absolute right-2 top-10 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                          <ActionItem icon={Pencil} label="Edit" onClick={() => { setActionsOpen(null); onRowClick(r); }} disabled={r.origin === "catalog"} />
                          {r.is_active ? (
                            <ActionItem icon={PauseCircle} label="Pause" onClick={() => togglePause(r)} />
                          ) : (
                            <ActionItem icon={PlayCircle} label="Resume" onClick={() => togglePause(r)} />
                          )}
                          <div className="my-1 border-t border-slate-100" />
                          <ActionItem icon={Trash2} label="Archive" onClick={() => archive(r)} danger />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function ActionItem({ icon: Icon, label, onClick, disabled = false, danger = false }: { icon: typeof Coins; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-left transition ${
        disabled
          ? "text-slate-300 cursor-not-allowed"
          : danger
            ? "text-rose-600 hover:bg-rose-50"
            : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function Stat({ n, label, dim = false }: { n: number | string; label: string; dim?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5">
      <div className={`text-2xl font-bold tabular-nums ${dim ? "text-slate-400" : "text-slate-900"}`}>{n}</div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

type PillOpt = { key: string; label: string; count: number; iconClass: string; Icon?: typeof Coins };

function PillGroup({ label, options, active, onToggle }: { label: string; options: PillOpt[]; active: Set<string>; onToggle: (k: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1.5 self-center">{label}</span>
      {options.map((o) => {
        const on = active.has(o.key);
        return (
          <button
            key={o.key}
            onClick={() => onToggle(o.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border transition ${on ? "bg-slate-900 text-white border-slate-900" : `${o.iconClass} hover:opacity-80`}`}
          >
            {o.Icon && <o.Icon className="w-3 h-3" />}
            {o.label}
            <span className={`text-[10px] px-1 rounded ${on ? "bg-black/20" : "bg-white/40"}`}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}
