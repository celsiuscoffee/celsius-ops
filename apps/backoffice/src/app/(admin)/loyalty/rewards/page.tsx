"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Coffee,
  Cake,
  Tag,
  ShoppingBag,
  Gift,
  Power,
  PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────
// Slim rewards admin.
// Rewards = the catalog members redeem with points (drinks, vouchers,
// merch). Discount mechanics now live on Promotions; if a reward needs
// to apply a discount at checkout, it points at a promotion via
// linked_promotion_id.
// ──────────────────────────────────────────────────────────

type RewardType =
  | "standard"
  | "new_member"
  | "birthday"
  | "points_shop"
  | "post_purchase"
  | "tier_perk";

type DistributionMethod =
  | { method: "points_shop"; points_cost: number }
  | { method: "auto_new_member" }
  | { method: "auto_birthday" }
  | { method: "auto_post_purchase" }
  | { method: "auto_tier"; tier_id?: string; frequency?: "monthly" | "weekly" | "once" };

interface Reward {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: "drink" | "food" | "voucher" | "merch";
  stock: number | null;
  is_active: boolean;
  image_url: string | null;
  reward_type: RewardType;
  validity_days: number | null;
  max_redemptions_per_member: number | null;
  auto_issue: boolean;
  linked_promotion_id: string | null;
  distribution_methods: DistributionMethod[];
}

const distributionLabels: Record<DistributionMethod["method"], string> = {
  points_shop: "Points shop",
  auto_new_member: "New member",
  auto_birthday: "Birthday",
  auto_post_purchase: "Post-purchase",
  auto_tier: "Tier perk",
};

const distributionColors: Record<DistributionMethod["method"], string> = {
  points_shop: "bg-blue-50 text-blue-700",
  auto_new_member: "bg-green-50 text-green-700",
  auto_birthday: "bg-pink-50 text-pink-700",
  auto_post_purchase: "bg-amber-50 text-amber-700",
  auto_tier: "bg-purple-50 text-purple-700",
};

interface Promotion {
  id: string;
  name: string;
  trigger_type: string;
  discount_type: string;
}

const categoryIcons: Record<Reward["category"], React.ElementType> = {
  drink: Coffee,
  food: Cake,
  voucher: Tag,
  merch: ShoppingBag,
};

const categoryColors: Record<Reward["category"], string> = {
  drink: "bg-blue-50 text-blue-700",
  food: "bg-orange-50 text-orange-700",
  voucher: "bg-purple-50 text-purple-700",
  merch: "bg-emerald-50 text-emerald-700",
};

const rewardTypeLabels: Record<RewardType, string> = {
  standard: "Standard",
  new_member: "New member",
  birthday: "Birthday",
  points_shop: "Points shop",
  post_purchase: "Post-purchase",
  tier_perk: "Tier perk",
};

type Filter = "all" | DistributionMethod["method"];

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "points_shop", label: "Points shop" },
  { key: "auto_new_member", label: "New member" },
  { key: "auto_birthday", label: "Birthday" },
  { key: "auto_post_purchase", label: "Post-purchase" },
  { key: "auto_tier", label: "Tier perk" },
];

export default function RewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  async function load() {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch("/api/loyalty/rewards?brand_id=brand-celsius", {
          credentials: "include",
        }),
        fetch("/api/loyalty/promotions?brand_id=brand-celsius", {
          credentials: "include",
        }),
      ]);
      const rData = await rRes.json();
      const pData = await pRes.json();
      setRewards(Array.isArray(rData) ? rData : []);
      setPromotions(Array.isArray(pData) ? pData : []);
    } catch {
      setRewards([]);
      setPromotions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(r: Reward) {
    await fetch("/api/loyalty/rewards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: r.id, is_active: !r.is_active }),
    });
    load();
  }

  async function remove(r: Reward) {
    if (!confirm(`Delete "${r.name}"?`)) return;
    await fetch(`/api/loyalty/rewards?id=${encodeURIComponent(r.id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    load();
  }

  const filtered = rewards.filter(
    (r) =>
      filter === "all" ||
      (r.distribution_methods ?? []).some((d) => d.method === filter),
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gift className="w-6 h-6" />
            Rewards
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Catalog of redeemable items. Discount mechanics live on{" "}
            <a href="/loyalty/promotions" className="underline">
              Promotions
            </a>
            ; link a promotion below to apply a discount when a reward is redeemed.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New reward
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border",
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground">No rewards.</div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Distribution</th>
                <th className="px-4 py-3 font-medium text-right">Points</th>
                <th className="px-4 py-3 font-medium">Linked promo</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const Icon = categoryIcons[r.category] ?? Gift;
                const linked = promotions.find(
                  (p) => p.id === r.linked_promotion_id,
                );
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-9 h-9 rounded-lg flex items-center justify-center",
                            categoryColors[r.category],
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{r.name}</div>
                          {r.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {r.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.distribution_methods ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">
                            (none)
                          </span>
                        ) : (
                          (r.distribution_methods ?? []).map((d, i) => (
                            <span
                              key={i}
                              className={cn(
                                "text-[11px] px-2 py-0.5 rounded-full font-medium",
                                distributionColors[d.method] ?? "bg-muted",
                              )}
                            >
                              {distributionLabels[d.method] ?? d.method}
                              {d.method === "points_shop" &&
                                ` · ${d.points_cost ?? 0}pt`}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {(r.points_required ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {linked ? (
                        <a
                          href="/loyalty/promotions"
                          className="text-primary hover:underline"
                        >
                          {linked.name}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(r)}
                        className={cn(
                          "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded",
                          r.is_active
                            ? "text-emerald-600 hover:bg-emerald-50"
                            : "text-gray-500 hover:bg-muted",
                        )}
                      >
                        {r.is_active ? (
                          <Power className="w-3.5 h-3.5" />
                        ) : (
                          <PowerOff className="w-3.5 h-3.5" />
                        )}
                        {r.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(r)}
                          className="p-1.5 rounded-md hover:bg-muted"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(r)}
                          className="p-1.5 rounded-md hover:bg-muted text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <RewardModal
          reward={editing}
          promotions={promotions}
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

function RewardModal({
  reward,
  promotions,
  onClose,
  onSaved,
}: {
  reward: Reward | null;
  promotions: Promotion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Reward>>(
    reward ?? {
      name: "",
      description: "",
      points_required: 0,
      category: "drink",
      reward_type: "standard",
      stock: null,
      is_active: true,
      validity_days: null,
      max_redemptions_per_member: null,
      linked_promotion_id: null,
      distribution_methods: [{ method: "points_shop", points_cost: 100 }],
    },
  );

  const methods = draft.distribution_methods ?? [];

  function addMethod(method: DistributionMethod["method"]) {
    if (methods.some((m) => m.method === method)) return;
    let next: DistributionMethod;
    if (method === "points_shop") next = { method, points_cost: 100 };
    else if (method === "auto_tier") next = { method, frequency: "monthly" };
    else next = { method } as DistributionMethod;
    setDraft({ ...draft, distribution_methods: [...methods, next] });
  }

  function removeMethod(method: DistributionMethod["method"]) {
    setDraft({
      ...draft,
      distribution_methods: methods.filter((m) => m.method !== method),
    });
  }

  function updateMethod(
    method: DistributionMethod["method"],
    patch: Partial<DistributionMethod>,
  ) {
    setDraft({
      ...draft,
      distribution_methods: methods.map((m) =>
        m.method === method ? ({ ...m, ...patch } as DistributionMethod) : m,
      ) as DistributionMethod[],
    });
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Derive legacy fields from distribution_methods so storefront /
      // cron readers keep working until they're migrated. The first
      // method wins for the single-valued reward_type column.
      const legacy = deriveLegacyFromMethods(methods);
      const payload = {
        ...draft,
        ...legacy,
        distribution_methods: methods,
      };
      const res = await fetch("/api/loyalty/rewards", {
        method: reward ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
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
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">
            {reward ? "Edit reward" : "New reward"}
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

          <div className="grid grid-cols-3 gap-3">
            <Field label="Points required">
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.points_required ?? 0}
                onChange={(e) =>
                  setDraft({ ...draft, points_required: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Category">
              <select
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.category ?? "drink"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    category: e.target.value as Reward["category"],
                  })
                }
              >
                <option value="drink">Drink</option>
                <option value="food">Food</option>
                <option value="voucher">Voucher</option>
                <option value="merch">Merch</option>
              </select>
            </Field>
          </div>

          <Field label="Distribution methods (how members get this reward)">
            <div className="space-y-2">
              {methods.map((m) => (
                <div
                  key={m.method}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border p-2.5",
                    distributionColors[m.method] ?? "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-sm font-semibold">
                      {distributionLabels[m.method]}
                    </span>
                    {m.method === "points_shop" && (
                      <input
                        type="number"
                        min={0}
                        className="w-24 px-2 py-1 rounded border bg-background text-sm"
                        value={m.points_cost ?? 0}
                        onChange={(e) =>
                          updateMethod("points_shop", {
                            method: "points_shop",
                            points_cost: Number(e.target.value),
                          })
                        }
                      />
                    )}
                    {m.method === "points_shop" && (
                      <span className="text-xs text-muted-foreground">pts</span>
                    )}
                    {m.method === "auto_tier" && (
                      <>
                        <select
                          className="px-2 py-1 rounded border bg-background text-sm"
                          value={m.tier_id ?? ""}
                          onChange={(e) =>
                            updateMethod("auto_tier", {
                              method: "auto_tier",
                              tier_id: e.target.value || undefined,
                              frequency: m.frequency ?? "monthly",
                            })
                          }
                        >
                          <option value="">— Select tier —</option>
                          <option value="tier-celsius-bronze">☕ Bronze</option>
                          <option value="tier-celsius-silver">⭐ Silver</option>
                          <option value="tier-celsius-gold">🌟 Gold</option>
                          <option value="tier-celsius-elite">👑 Elite</option>
                        </select>
                        <select
                          className="px-2 py-1 rounded border bg-background text-sm"
                          value={m.frequency ?? "monthly"}
                          onChange={(e) =>
                            updateMethod("auto_tier", {
                              method: "auto_tier",
                              tier_id: m.tier_id,
                              frequency: e.target.value as "monthly" | "weekly" | "once",
                            })
                          }
                        >
                          <option value="once">Once</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMethod(m.method)}
                    className="p-1 rounded hover:bg-black/10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    "points_shop",
                    "auto_new_member",
                    "auto_birthday",
                    "auto_post_purchase",
                    "auto_tier",
                  ] as DistributionMethod["method"][]
                )
                  .filter((m) => !methods.some((x) => x.method === m))
                  .map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => addMethod(m)}
                      className="text-xs px-2.5 py-1 rounded-full border border-dashed hover:bg-muted"
                    >
                      + {distributionLabels[m]}
                    </button>
                  ))}
              </div>
            </div>
          </Field>

          <Field label="Linked promotion (applies discount at checkout)">
            <select
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={draft.linked_promotion_id ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  linked_promotion_id: e.target.value || null,
                })
              }
            >
              <option value="">— No promotion (no discount) —</option>
              {promotions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.discount_type}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Validity (days)">
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.validity_days ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    validity_days: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Max per member">
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.max_redemptions_per_member ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_redemptions_per_member: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="Stock">
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.stock ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    stock: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="Unlimited"
              />
            </Field>
          </div>

          <Field label="Image URL (optional)">
            <input
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={draft.image_url ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, image_url: e.target.value || null })
              }
              placeholder="https://…"
            />
          </Field>

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

// Derive legacy single-valued columns from the new distribution_methods
// array so old readers (storefront, cron) keep working during the
// transition. Priority: explicit auto_* methods over points_shop.
function deriveLegacyFromMethods(
  methods: DistributionMethod[],
): {
  reward_type: RewardType;
  auto_issue: boolean;
  points_required: number;
} {
  const has = (m: DistributionMethod["method"]) =>
    methods.some((x) => x.method === m);
  if (has("auto_birthday"))
    return { reward_type: "birthday", auto_issue: true, points_required: 0 };
  if (has("auto_new_member"))
    return { reward_type: "new_member", auto_issue: true, points_required: 0 };
  if (has("auto_post_purchase"))
    return { reward_type: "post_purchase", auto_issue: true, points_required: 0 };
  if (has("auto_tier"))
    return { reward_type: "tier_perk", auto_issue: false, points_required: 0 };
  const ps = methods.find((x) => x.method === "points_shop");
  if (ps && ps.method === "points_shop")
    return {
      reward_type: "points_shop",
      auto_issue: false,
      points_required: ps.points_cost ?? 0,
    };
  return { reward_type: "standard", auto_issue: false, points_required: 0 };
}
