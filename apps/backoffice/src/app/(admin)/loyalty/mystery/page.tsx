"use client";

import { useState, useEffect, useMemo } from "react";
import { Sparkles, Plus, Pencil, Trash2, X, Gift, Coffee, Croissant, ArrowUp } from "lucide-react";

type OutcomeType = "beans_multiplier" | "flat_beans" | "voucher" | "no_bonus" | "surprise_in_store";

// Mirrors the row shape of /api/loyalty/reward-kinds — labels are
// admin-editable now, but the id/behaviour is still code-defined
// (the OutcomeType union above is still the source of truth for what
// kinds the engine knows how to act on).
interface RewardKind {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  is_active: boolean;
}

interface MysteryEntry {
  id: string;
  brand_id: string;
  label: string;
  icon: string;
  reveal_emoji: string | null;
  outcome_type: OutcomeType;
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_template_id: string | null;
  weight: number;
  min_tier: string | null;
  birthday_month_boost: boolean;
  is_active: boolean;
}

interface VoucherTemplate { id: string; title: string; category: string }

const BRAND_ID = "brand-celsius";
const TIERS = ["Bronze", "Silver", "Gold", "Platinum"];
// Fallback labels used only if /api/loyalty/reward-kinds fails to load —
// the source of truth is now the reward_kinds table (editable via the
// Reward Library → Reward Kinds admin page).
const OUTCOME_LABELS: Record<OutcomeType, string> = {
  beans_multiplier: "Point Multiplier",
  flat_beans: "Flat Bonus Points",
  voucher: "Voucher",
  no_bonus: "No Bonus (just Points)",
  surprise_in_store: "Surprise (barista)",
};

export default function MysteryPage() {
  const [entries, setEntries] = useState<MysteryEntry[]>([]);
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [kinds, setKinds] = useState<RewardKind[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MysteryEntry | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/loyalty/mystery?brand_id=${BRAND_ID}`, { credentials: "include" }),
        fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" }),
        fetch(`/api/loyalty/reward-kinds`, { credentials: "include" }),
      ]);
      const [entriesData, templatesData, kindsData] = await Promise.all([
        r1.json(), r2.json(), r3.json(),
      ]);
      setEntries(Array.isArray(entriesData) ? entriesData : []);
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
      setKinds(Array.isArray(kindsData) ? kindsData : []);
    } catch { setEntries([]); setTemplates([]); setKinds([]); }
    finally { setLoading(false); }
  }

  // Resolve an outcome_type id to its display label. Prefers the
  // admin-editable reward_kinds.label, falls back to the hardcoded
  // OUTCOME_LABELS if reward-kinds didn't load.
  function kindLabel(id: OutcomeType): string {
    return kinds.find((k) => k.id === id)?.label ?? OUTCOME_LABELS[id];
  }

  useEffect(() => { load(); }, []);

  const totalWeight = useMemo(
    () => entries.filter((e) => e.is_active).reduce((sum, e) => sum + e.weight, 0),
    [entries]
  );

  async function toggleActive(e: MysteryEntry) {
    await fetch(`/api/loyalty/mystery`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: e.id, is_active: !e.is_active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/loyalty/mystery?id=${id}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="w-6 h-6" />
            Mystery Reward Pool
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Tap-to-reveal outcomes customers can win after each order. Weights are relative —
            outcomes are picked proportionally. Tune to balance excitement vs cost.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Outcome
        </button>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active outcomes" value={entries.filter((e) => e.is_active).length.toString()} />
        <Stat label="Total weight" value={totalWeight.toString()} />
        <Stat label="No-bonus drop rate" value={
          totalWeight > 0
            ? `${Math.round((entries.filter((e) => e.is_active && e.outcome_type === "no_bonus").reduce((s, e) => s + e.weight, 0) / totalWeight) * 100)}%`
            : "—"
        } />
        <Stat label="Voucher drop rate" value={
          totalWeight > 0
            ? `${Math.round((entries.filter((e) => e.is_active && e.outcome_type === "voucher").reduce((s, e) => s + e.weight, 0) / totalWeight) * 100)}%`
            : "—"
        } />
      </div>

      {/* Probability table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Outcome</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Value</th>
                <th className="text-right px-4 py-3">Weight</th>
                <th className="text-right px-4 py-3">Drop %</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-2">
                      {e.reveal_emoji && <span>{e.reveal_emoji}</span>}
                      {e.label}
                    </div>
                    {e.min_tier && <div className="text-xs text-muted-foreground">{e.min_tier}+ only</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{kindLabel(e.outcome_type)}</td>
                  <td className="px-4 py-3">
                    {e.outcome_type === "beans_multiplier" && <strong>{e.multiplier_value}×</strong>}
                    {e.outcome_type === "flat_beans" && <strong>+{e.flat_beans_value} Points</strong>}
                    {e.outcome_type === "voucher" && (
                      <strong>{templates.find((t) => t.id === e.voucher_template_id)?.title ?? "—"}</strong>
                    )}
                    {e.outcome_type === "no_bonus" && <span className="text-muted-foreground">—</span>}
                    {e.outcome_type === "surprise_in_store" && <em>Barista surprise</em>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{e.weight}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totalWeight > 0 && e.is_active ? `${((e.weight / totalWeight) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(e)}
                      className={`text-xs font-medium px-2.5 py-1 rounded ${
                        e.is_active
                          ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {e.is_active ? "● Active" : "○ Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(e)} className="p-1.5 hover:bg-muted rounded">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(e.id)} className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <MysteryModal
          entry={editing}
          templates={templates}
          kinds={kinds}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────

function MysteryModal({
  entry, templates, kinds, onClose, onSaved,
}: {
  entry: MysteryEntry | null;
  templates: VoucherTemplate[];
  kinds: RewardKind[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Filter to active kinds for the dropdown; if the existing entry
  // references a kind that has since been deactivated, surface it
  // anyway (with a "(inactive)" suffix) so the admin can save the
  // form without an orphaned dropdown value.
  const activeKinds = kinds.filter((k) => k.is_active);
  const dropdownKinds: RewardKind[] = entry && !activeKinds.some((k) => k.id === entry.outcome_type)
    ? [
        ...activeKinds,
        ...kinds.filter((k) => k.id === entry.outcome_type),
      ]
    : activeKinds;
  const [label, setLabel] = useState(entry?.label ?? "");
  const [outcomeType, setOutcomeType] = useState<OutcomeType>(entry?.outcome_type ?? "beans_multiplier");
  const [multiplier, setMultiplier] = useState<number>(entry?.multiplier_value ?? 2);
  const [flatBeans, setFlatBeans] = useState<number>(entry?.flat_beans_value ?? 0);
  const [voucherTemplateId, setVoucherTemplateId] = useState<string>(entry?.voucher_template_id ?? "");
  const [weight, setWeight] = useState(entry?.weight ?? 10);
  const [revealEmoji, setRevealEmoji] = useState(entry?.reveal_emoji ?? "");
  const [minTier, setMinTier] = useState<string>(entry?.min_tier ?? "");
  const [birthdayBoost, setBirthdayBoost] = useState(entry?.birthday_month_boost ?? false);
  const [isActive, setIsActive] = useState(entry?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload = {
        brand_id: BRAND_ID,
        label,
        outcome_type: outcomeType,
        multiplier_value: outcomeType === "beans_multiplier" ? multiplier : null,
        flat_beans_value: outcomeType === "flat_beans" ? flatBeans : null,
        voucher_template_id: outcomeType === "voucher" ? voucherTemplateId || null : null,
        weight,
        reveal_emoji: revealEmoji || null,
        min_tier: minTier || null,
        birthday_month_boost: birthdayBoost,
        is_active: isActive,
      };

      const res = entry
        ? await fetch(`/api/loyalty/mystery`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: entry.id, ...payload }),
          })
        : await fetch(`/api/loyalty/mystery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Save failed");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl w-full max-w-xl md:max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">{entry ? "Edit Outcome" : "New Outcome"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Label">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="3× Point Multiplier" />
          </Field>

          <Field label="Outcome type">
            <select value={outcomeType} onChange={(e) => setOutcomeType(e.target.value as OutcomeType)} className="w-full border rounded-lg px-3 py-2 bg-background">
              {dropdownKinds.length === 0 ? (
                // Defensive: if reward-kinds API failed, fall back to
                // the hardcoded enum so the form still works.
                Object.entries(OUTCOME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)
              ) : (
                dropdownKinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}{!k.is_active ? " (inactive)" : ""}
                  </option>
                ))
              )}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Edit labels under Reward Library → Reward Kinds.
            </p>
          </Field>

          {outcomeType === "beans_multiplier" && (
            <Field label="Multiplier (e.g. 2.0 = double)">
              <input type="number" step={0.5} min={1} value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          )}
          {outcomeType === "flat_beans" && (
            <Field label="Flat Points amount">
              <input type="number" min={1} value={flatBeans} onChange={(e) => setFlatBeans(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          )}
          {outcomeType === "voucher" && (
            <Field label="Voucher template">
              <select value={voucherTemplateId} onChange={(e) => setVoucherTemplateId(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
                <option value="">— select —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight (relative)">
              <input type="number" min={0} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
            <Field label="Reveal emoji (optional)">
              <input value={revealEmoji} onChange={(e) => setRevealEmoji(e.target.value)} maxLength={4} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="✨" />
            </Field>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Targeting (optional)</div>
            <Field label="Minimum tier">
              <select value={minTier} onChange={(e) => setMinTier(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
                <option value="">All tiers</option>
                {TIERS.map((t) => <option key={t} value={t}>{t}+</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={birthdayBoost} onChange={(e) => setBirthdayBoost(e.target.checked)} />
              <span className="text-sm">Double weight in customer&apos;s birthday month</span>
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="text-sm">Active (in pool)</span>
          </label>

          {error && <div className="text-sm text-rose-500">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-muted text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : entry ? "Save changes" : "Create outcome"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 border-2 border-dashed rounded-xl">
      <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-medium mb-1">No outcomes yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        Add reveal outcomes to start showing Mystery Reward cards on order confirmation. We recommend at least one &quot;no bonus&quot; outcome at 50%+ weight to make wins feel like wins.
      </p>
      <button onClick={onCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium">
        <Plus className="w-4 h-4" /> Add first outcome
      </button>
    </div>
  );
}
