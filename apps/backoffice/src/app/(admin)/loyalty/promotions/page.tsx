"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Tag, Power, PowerOff, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Promotion {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  trigger_type: "auto" | "code" | "tier_perk" | "reward_link";
  promo_code: string | null;
  tier_id: string | null;
  discount_type:
    | "percentage_off"
    | "fixed_amount_off"
    | "free_item"
    | "bogo"
    | "combo_price"
    | "override_price";
  discount_value: number | null;
  max_discount_value: number | null;
  combo_price: number | null;
  override_price: number | null;
  min_order_value: number | null;
  valid_from: string | null;
  valid_until: string | null;
  day_of_week: number[];
  time_start: string | null;
  time_end: string | null;
  max_uses_total: number | null;
  max_uses_per_member: number | null;
  uses_count: number;
  stackable: boolean;
  is_active: boolean;
  priority: number;
}

const triggerLabels: Record<Promotion["trigger_type"], string> = {
  auto: "Auto-apply",
  code: "Promo code",
  tier_perk: "Tier perk",
  reward_link: "Reward redemption",
};

const triggerColors: Record<Promotion["trigger_type"], string> = {
  auto: "bg-blue-50 text-blue-700",
  code: "bg-purple-50 text-purple-700",
  tier_perk: "bg-amber-50 text-amber-700",
  reward_link: "bg-emerald-50 text-emerald-700",
};

const discountLabels: Record<Promotion["discount_type"], string> = {
  percentage_off: "% off",
  fixed_amount_off: "RM off",
  free_item: "Free item",
  bogo: "BOGO",
  combo_price: "Combo price",
  override_price: "Override price",
};

export default function PromotionsPage() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/promotions?brand_id=brand-celsius", {
        credentials: "include",
      });
      const data = await res.json();
      setPromos(Array.isArray(data) ? data : []);
    } catch {
      setPromos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(p: Promotion) {
    await fetch("/api/loyalty/promotions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
    });
    load();
  }

  async function remove(p: Promotion) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    await fetch(`/api/loyalty/promotions?id=${encodeURIComponent(p.id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    load();
  }

  function discountSummary(p: Promotion) {
    switch (p.discount_type) {
      case "percentage_off":
        return `${p.discount_value ?? 0}%${p.max_discount_value ? ` (cap RM${p.max_discount_value})` : ""}`;
      case "fixed_amount_off":
        return `RM${p.discount_value ?? 0}`;
      case "free_item":
        return "Cheapest free";
      case "bogo":
        return "Buy + free";
      case "combo_price":
        return p.combo_price != null ? `RM${p.combo_price} combo` : "Combo";
      case "override_price":
        return p.override_price != null ? `RM${p.override_price} each` : "Override";
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Tag className="w-6 h-6" />
            Promotions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discount engine. Auto-apply, promo codes, tier perks, and reward
            redemptions all flow through here. Higher priority promos apply
            first; non-stackable promos block lower-priority ones.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New promotion
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : promos.length === 0 ? (
        <div className="text-sm text-muted-foreground">No promotions yet.</div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium text-right">Uses</th>
                <th className="px-4 py-3 font-medium text-right">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.description}
                      </div>
                    )}
                    {p.promo_code && (
                      <div className="text-xs font-mono mt-1 inline-block px-2 py-0.5 rounded bg-muted">
                        {p.promo_code}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        triggerColors[p.trigger_type],
                      )}
                    >
                      {triggerLabels[p.trigger_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-muted-foreground">
                      {discountLabels[p.discount_type]}
                    </div>
                    <div className="font-medium">{discountSummary(p)}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.uses_count}
                    {p.max_uses_total ? ` / ${p.max_uses_total}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.priority}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(p)}
                      className={cn(
                        "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded",
                        p.is_active
                          ? "text-emerald-600 hover:bg-emerald-50"
                          : "text-gray-500 hover:bg-muted",
                      )}
                    >
                      {p.is_active ? (
                        <Power className="w-3.5 h-3.5" />
                      ) : (
                        <PowerOff className="w-3.5 h-3.5" />
                      )}
                      {p.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setEditing(p)}
                        className="p-1.5 rounded-md hover:bg-muted"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(p)}
                        className="p-1.5 rounded-md hover:bg-muted text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <PromoModal
          promo={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

interface TierOption {
  id: string;
  name: string;
  icon: string;
  slug: string;
}

function PromoModal({
  promo,
  onClose,
  onSaved,
}: {
  promo: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Promotion>>(
    promo ?? {
      name: "",
      description: "",
      trigger_type: "auto",
      discount_type: "percentage_off",
      discount_value: 10,
      stackable: false,
      is_active: true,
      priority: 0,
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierOption[]>([]);

  useEffect(() => {
    fetch("/api/loyalty/tiers?brand_id=brand-celsius", {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setTiers(Array.isArray(d) ? d : []))
      .catch(() => setTiers([]));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/loyalty/promotions", {
        method: promo ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">
            {promo ? "Edit promotion" : "New promotion"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Name">
            <input
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={draft.description ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Trigger">
              <select
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.trigger_type ?? "auto"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    trigger_type: e.target.value as Promotion["trigger_type"],
                  })
                }
              >
                <option value="auto">Auto-apply</option>
                <option value="code">Promo code</option>
                <option value="tier_perk">Tier perk</option>
                <option value="reward_link">Reward redemption</option>
              </select>
            </Field>
            <Field label="Discount type">
              <select
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.discount_type ?? "percentage_off"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    discount_type: e.target
                      .value as Promotion["discount_type"],
                  })
                }
              >
                <option value="percentage_off">Percentage off</option>
                <option value="fixed_amount_off">Fixed amount off (RM)</option>
                <option value="free_item">Free item (cheapest)</option>
                <option value="bogo">BOGO</option>
                <option value="combo_price">Combo price</option>
                <option value="override_price">Override price</option>
              </select>
            </Field>
          </div>

          {draft.trigger_type === "code" && (
            <Field label="Promo code">
              <input
                className="w-full px-3 py-2 rounded-md border bg-background font-mono uppercase"
                value={draft.promo_code ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, promo_code: e.target.value.toUpperCase() })
                }
                placeholder="WELCOME10"
              />
            </Field>
          )}

          {draft.trigger_type === "tier_perk" && (
            <Field label="Apply to tier">
              <select
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.tier_id ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, tier_id: e.target.value || null })
                }
              >
                <option value="">— Select a tier —</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount value">
              <input
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.discount_value ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    discount_value: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Max discount cap (RM)">
              <input
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.max_discount_value ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_discount_value: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min order value (RM)">
              <input
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.min_order_value ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    min_order_value: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Priority (higher wins)">
              <input
                type="number"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.priority ?? 0}
                onChange={(e) =>
                  setDraft({ ...draft, priority: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from">
              <input
                type="datetime-local"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.valid_from?.slice(0, 16) ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    valid_from: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Valid until">
              <input
                type="datetime-local"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.valid_until?.slice(0, 16) ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    valid_until: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Time start (happy hour)">
              <input
                type="time"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.time_start ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, time_start: e.target.value || null })
                }
              />
            </Field>
            <Field label="Time end">
              <input
                type="time"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.time_end ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, time_end: e.target.value || null })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Max uses (total)">
              <input
                type="number"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.max_uses_total ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_uses_total: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Max uses per member">
              <input
                type="number"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.max_uses_per_member ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_uses_per_member: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.stackable ?? false}
                onChange={(e) =>
                  setDraft({ ...draft, stackable: e.target.checked })
                }
              />
              Stackable with other promos
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_active ?? true}
                onChange={(e) =>
                  setDraft({ ...draft, is_active: e.target.checked })
                }
              />
              Active
            </label>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border hover:bg-muted text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !draft.name}
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
