"use client";

import { useState, useEffect } from "react";
import { Pencil, X, Plus, Trash2, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

type QualificationMetric = "visits" | "spend" | "spend_lifetime" | "either";

interface Tier {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
  min_visits: number;
  min_spend: number;
  qualification_metric: QualificationMetric;
  period_days: number;
  color: string;
  icon: string;
  benefits: string[];
  multiplier: number;
  sort_order: number;
  is_active: boolean;
}

const qualLabels: Record<QualificationMetric, string> = {
  visits: "Visits in period",
  spend: "Spend in period",
  spend_lifetime: "Lifetime spend",
  either: "Visits or spend (period)",
};

export default function TiersPage() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Tier | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/tiers?brand_id=brand-celsius", {
        credentials: "include",
      });
      const data = await res.json();
      setTiers(Array.isArray(data) ? data : []);
    } catch {
      setTiers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(updated: Tier) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/loyalty/tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: updated.id,
          name: updated.name,
          min_visits: updated.min_visits,
          min_spend: updated.min_spend,
          qualification_metric: updated.qualification_metric,
          period_days: updated.period_days,
          color: updated.color,
          icon: updated.icon,
          benefits: updated.benefits,
          multiplier: updated.multiplier,
          is_active: updated.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Crown className="w-6 h-6" />
            Member Tiers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Members are placed into the highest tier they qualify for, based on
            visits in the rolling period. Higher tiers earn a bigger points multiplier.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : tiers.length === 0 ? (
        <div className="text-sm text-muted-foreground">No tiers configured.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((t) => (
            <TierCard key={t.id} tier={t} onEdit={() => setEditing(t)} />
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          tier={editing}
          saving={saving}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={save}
        />
      )}
    </div>
  );
}

function TierCard({ tier, onEdit }: { tier: Tier; onEdit: () => void }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-sm",
        !tier.is_active && "opacity-50",
      )}
      style={{ borderTopColor: tier.color, borderTopWidth: 4 }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{tier.icon}</span>
          <div>
            <div className="font-semibold text-lg">{tier.name}</div>
            <div className="text-xs text-muted-foreground">{tier.slug}</div>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md hover:bg-muted"
          aria-label="Edit"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Qualifies on</span>
          <span className="font-medium text-xs">{qualLabels[tier.qualification_metric]}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Min visits</span>
          <span className="font-medium">{tier.min_visits} / {tier.period_days}d</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Min spend</span>
          <span className="font-medium">RM{tier.min_spend}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Earn multiplier</span>
          <span className="font-medium">{tier.multiplier}×</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status</span>
          <span
            className={cn(
              "font-medium",
              tier.is_active ? "text-emerald-600" : "text-gray-500",
            )}
          >
            {tier.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {tier.benefits && tier.benefits.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            BENEFITS
          </div>
          <ul className="space-y-1 text-sm">
            {tier.benefits.map((b, i) => (
              <li key={i} className="text-foreground">
                • {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EditModal({
  tier,
  saving,
  error,
  onCancel,
  onSave,
}: {
  tier: Tier;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (t: Tier) => void;
}) {
  const [draft, setDraft] = useState<Tier>(tier);
  const [benefitsText, setBenefitsText] = useState(
    (tier.benefits || []).join("\n"),
  );

  function commit() {
    const benefits = benefitsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({ ...draft, benefits });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">{draft.icon}</span>
            Edit {draft.name}
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Tier Name">
            <input
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>

          <Field label="Qualification metric">
            <select
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={draft.qualification_metric}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  qualification_metric: e.target.value as QualificationMetric,
                })
              }
            >
              <option value="visits">Visits in period</option>
              <option value="spend">Spend in period (RM)</option>
              <option value="spend_lifetime">Lifetime spend (RM)</option>
              <option value="either">Visits OR spend in period</option>
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Min visits">
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.min_visits}
                onChange={(e) =>
                  setDraft({ ...draft, min_visits: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Min spend (RM)">
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.min_spend}
                onChange={(e) =>
                  setDraft({ ...draft, min_spend: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Period (days)">
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.period_days}
                onChange={(e) =>
                  setDraft({ ...draft, period_days: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Multiplier (e.g. 1.5)">
              <input
                type="number"
                step="0.05"
                min={1}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.multiplier}
                onChange={(e) =>
                  setDraft({ ...draft, multiplier: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Icon (emoji)">
              <input
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Color (hex)">
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="w-12 h-10 rounded-md border"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
              <input
                className="flex-1 px-3 py-2 rounded-md border bg-background font-mono text-sm"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </div>
          </Field>

          <Field label="Benefits (one per line)">
            <textarea
              rows={4}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={benefitsText}
              onChange={(e) => setBenefitsText(e.target.value)}
              placeholder="1.5× points on every purchase&#10;Free size upgrade once a month"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) =>
                setDraft({ ...draft, is_active: e.target.checked })
              }
            />
            Active
          </label>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md border hover:bg-muted text-sm"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
