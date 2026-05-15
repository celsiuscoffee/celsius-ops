"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Tag, Power, PowerOff, X, Sparkles, TrendingUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Promotion {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  trigger_type: "auto" | "code" | "tier_perk" | "reward_link" | "first_order";
  promo_code: string | null;
  tier_id: string | null;
  eligible_member_tags: string[];
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
  /** Products this promo applies to. For combo / override / free-item
   *  promos these are the gate AND the discount target. Empty array
   *  means "any product" (only meaningful for percentage / fixed). */
  applicable_products: string[];
  /** Categories this promo applies to (sale scope, not combo gate).
   *  E.g. ["mocktails"] = "20% off all Mocktails". Customer-side
   *  product-sales lib uses this to render strikethrough on every
   *  product in those categories. */
  applicable_categories: string[];
  /** Combo gate — when set, every product id here must be in the
   *  cart for the discount to trigger. */
  combo_product_ids: string[];
  /** Category-level combo gate — when set, at least one cart line
   *  per category must be present. Both gates can be set; both must
   *  pass. Empty arrays = no gate. */
  combo_category_ids: string[];
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
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
  first_order: "First order",
};

const triggerColors: Record<Promotion["trigger_type"], string> = {
  auto: "bg-blue-50 text-blue-700",
  code: "bg-purple-50 text-purple-700",
  tier_perk: "bg-amber-50 text-amber-700",
  reward_link: "bg-emerald-50 text-emerald-700",
  first_order: "bg-pink-50 text-pink-700",
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
            Discount Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One place for every discount rule that runs at checkout. Auto-apply, promo codes, tier
            perks, and reward redemptions all flow through here. Higher priority rules apply first;
            non-stackable rules block lower-priority ones.
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

      {/* AI-mined combo recommendations from POS history. Sits above
          the live promo list so admins see "what's missing" before
          managing what's already there. Auto-suppresses suggestions
          for category pairs that already have an active combo. */}
      <ComboRecommendations onApplied={load} />

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
  const [memberTags, setMemberTags] = useState<{ tag: string; count: number }[]>([]);
  const [tagInput, setTagInput] = useState("");
  // Menu products power the applicable_products / combo product picker.
  // Pulled from /api/pickup/products so the picker always reflects
  // exactly what customers can order. Cached for the editor lifetime —
  // products don't change while the dialog is open.
  const [products, setProducts] = useState<{ id: string; name: string; category_id: string; image_url: string | null }[]>([]);
  const [productSearch, setProductSearch] = useState("");
  // Categories power the combo CATEGORY gate ("any classic drink + any
  // roti bakar — RM2 off") which is the common F&B case. Without
  // categories the admin would have to enumerate every drink × every
  // food combination by product.
  const [categories, setCategories] = useState<{ id: string; name: string; position: number }[]>([]);

  useEffect(() => {
    fetch("/api/loyalty/tiers?brand_id=brand-celsius", {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setTiers(Array.isArray(d) ? d : []))
      .catch(() => setTiers([]));
    fetch("/api/loyalty/members/tags", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setMemberTags(Array.isArray(d) ? d : []))
      .catch(() => setMemberTags([]));
    fetch("/api/pickup/products", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setProducts(Array.isArray(d.products) ? d.products : []);
        // /api/pickup/products returns { products, categories } — the
        // categories list drives the combo CATEGORY picker below.
        setCategories(Array.isArray(d.categories) ? d.categories : []);
      })
      .catch(() => {
        setProducts([]);
        setCategories([]);
      });
  }, []);

  const selectedTags = draft.eligible_member_tags ?? [];
  function toggleTag(tag: string) {
    setDraft({
      ...draft,
      eligible_member_tags: selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag],
    });
  }
  function addCustomTag() {
    const t = tagInput.trim();
    if (!t || selectedTags.includes(t)) {
      setTagInput("");
      return;
    }
    setDraft({ ...draft, eligible_member_tags: [...selectedTags, t] });
    setTagInput("");
  }

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
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl md:max-w-4xl max-h-[90vh] overflow-y-auto">
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
                <option value="first_order">First order</option>
              </select>
            </Field>
            <Field label="Discount type">
              <select
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.discount_type ?? "percentage_off"}
                onChange={(e) => {
                  const next = e.target.value as Promotion["discount_type"];
                  // Switching AWAY from combo_price means the category +
                  // product COMBO gates no longer apply — clear them so
                  // the evaluator doesn't surprise the customer with a
                  // stale all-or-nothing gate after admin thinks they
                  // saved a plain sale. Mirror selection back into
                  // applicable_* if needed when switching to combo mode
                  // is unnecessary because the picker writes to the right
                  // field directly when in combo mode.
                  setDraft({
                    ...draft,
                    discount_type: next,
                    ...(next !== "combo_price"
                      ? { combo_category_ids: [], combo_product_ids: [] }
                      : {}),
                  });
                }}
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

          <Field label="Restrict to member tags (optional)">
            {selectedTags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className="flex items-center gap-1 rounded-full bg-[#C2452D] px-2.5 py-1 text-xs text-white"
                  >
                    {t}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
            {memberTags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {memberTags
                  .filter((t) => !selectedTags.includes(t.tag))
                  .map((t) => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => toggleTag(t.tag)}
                      className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
                      title={`${t.count} member${t.count === 1 ? "" : "s"}`}
                    >
                      {t.tag}{" "}
                      <span className="text-muted-foreground">· {t.count}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-md border bg-background text-sm"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                placeholder="Add a custom tag…"
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!tagInput.trim()}
                className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tap to select / remove. Leave empty for all members. Member must
              have at least one matching tag (case-sensitive).
            </p>
          </Field>

          {/* Discount value — meaning depends on discount_type so we
              label it dynamically. Percentage = "10" (= 10%), fixed
              amount = "5" (= RM5 off), and so on. Combo/override/bogo
              hide this entirely and use their own inputs below. */}
          {(draft.discount_type === "percentage_off" ||
            draft.discount_type === "fixed_amount_off") && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={
                  draft.discount_type === "percentage_off"
                    ? "Discount % (e.g. 10 = 10% off)"
                    : "Discount amount (RM)"
                }
              >
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
          )}

          {/* Combo price — only meaningful when discount_type ===
              "combo_price". The bundle of selected products is sold
              for this fixed total instead of summing line prices. */}
          {draft.discount_type === "combo_price" && (
            <Field label="Combo bundle price (RM)" hint="Total charged when all selected products are in the cart">
              <input
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.combo_price ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    combo_price: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="18.00"
              />
            </Field>
          )}

          {/* Override price — per-item replacement price. */}
          {draft.discount_type === "override_price" && (
            <Field label="Override price per item (RM)" hint="Each selected line is sold at this unit price">
              <input
                type="number"
                step="0.01"
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.override_price ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    override_price: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="8.90"
              />
            </Field>
          )}

          {/* BOGO quantities. */}
          {draft.discount_type === "bogo" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Buy quantity">
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 rounded-md border bg-background"
                  value={draft.bogo_buy_qty ?? 1}
                  onChange={(e) =>
                    setDraft({ ...draft, bogo_buy_qty: Number(e.target.value) || 1 })
                  }
                />
              </Field>
              <Field label="Free quantity">
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 rounded-md border bg-background"
                  value={draft.bogo_free_qty ?? 1}
                  onChange={(e) =>
                    setDraft({ ...draft, bogo_free_qty: Number(e.target.value) || 1 })
                  }
                />
              </Field>
            </div>
          )}

          {/* Category picker — dual-purpose:
                - combo_price → writes to combo_category_ids (COMBO GATE:
                  pick 2+ categories that must all be in cart together).
                - everything else → writes to applicable_categories
                  (SALE SCOPE: pick categories whose products this promo
                  applies to, e.g. "All Mocktails 20% off").
              The field-name swap matters because the loyalty evaluator
              reads them for different purposes; the customer-side
              product-sales lib also distinguishes (combo gate hides
              from the strikethrough surface, sale scope shows it). */}
          {(() => {
            const isComboMode = draft.discount_type === "combo_price";
            const targetField: "combo_category_ids" | "applicable_categories" =
              isComboMode ? "combo_category_ids" : "applicable_categories";
            const selectedList = (isComboMode
              ? draft.combo_category_ids
              : draft.applicable_categories) ?? [];
            return (
              <Field
                label={
                  isComboMode
                    ? "Combo categories (gate)"
                    : "Apply to categories (optional)"
                }
                hint={
                  isComboMode
                    ? "At least one product from each of these categories must be in cart"
                    : "Pick categories to scope this sale (e.g. all Mocktails 20% off). Leave empty to scope by products only."
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {categories.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Loading categories…</span>
                  ) : (
                    categories.map((c) => {
                      const selected = selectedList.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            const next = selected
                              ? selectedList.filter((x) => x !== c.id)
                              : [...selectedList, c.id];
                            setDraft({ ...draft, [targetField]: next } as typeof draft);
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs border transition",
                            selected
                              ? "bg-amber-600 text-white border-amber-600"
                              : "bg-background hover:bg-muted/50 border-muted-foreground/30",
                          )}
                        >
                          {c.name}
                        </button>
                      );
                    })
                  )}
                </div>
                {isComboMode && selectedList.length >= 2 && (
                  <p className="mt-2 text-[11px] text-emerald-700">
                    Combo gate: any {selectedList.map((id) => categories.find((c) => c.id === id)?.name ?? id).join(" + any ")}
                  </p>
                )}
                {!isComboMode && selectedList.length > 0 && (
                  <p className="mt-2 text-[11px] text-emerald-700">
                    Sale applies to: {selectedList.map((id) => categories.find((c) => c.id === id)?.name ?? id).join(", ")}
                  </p>
                )}
              </Field>
            );
          })()}

          {/* Product picker — visible for ANY discount type because
              every promo can be scoped to specific products. For
              combo_price the picker doubles as the COMBO GATE: every
              selected product must be in the cart for the combo to
              trigger (enforced in the loyalty evaluator). */}
          <Field
            label={
              draft.discount_type === "combo_price"
                ? "Combo products — all of these must be in cart"
                : draft.discount_type === "override_price"
                ? "Apply override to these products"
                : "Apply to products (optional)"
            }
            hint={
              draft.discount_type === "combo_price"
                ? "Pick 2+ products that combine for the bundle price"
                : "Pick the products this sale applies to. Combined with category scope above — leave both empty for a cart-wide promo (won't show as sale price on menu)."
            }
          >
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full px-3 py-2 rounded-md border bg-background mb-2 text-sm"
            />
            <div className="max-h-48 overflow-y-auto border rounded-md bg-background">
              {products
                .filter(
                  (p) =>
                    !productSearch ||
                    p.name.toLowerCase().includes(productSearch.toLowerCase()),
                )
                .slice(0, 50)
                .map((p) => {
                  const selectedAp = draft.applicable_products ?? [];
                  const isSelected = selectedAp.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const isOn = isSelected;
                        const next = isOn
                          ? selectedAp.filter((id) => id !== p.id)
                          : [...selectedAp, p.id];
                        setDraft({
                          ...draft,
                          applicable_products: next,
                          // Mirror into combo_product_ids when in combo
                          // mode so the loyalty gate has what it needs.
                          ...(draft.discount_type === "combo_price"
                            ? { combo_product_ids: next }
                            : {}),
                        });
                      }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-sm border-b last:border-b-0 flex items-center gap-2",
                        isSelected
                          ? "bg-amber-50 text-amber-900 font-medium"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center text-[10px]",
                          isSelected ? "bg-amber-600 border-amber-600 text-white" : "border-muted-foreground/30",
                        )}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.category_id}</span>
                    </button>
                  );
                })}
              {products.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading products…</div>
              )}
            </div>
            {(draft.applicable_products?.length ?? 0) > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {draft.applicable_products!.length} product{draft.applicable_products!.length === 1 ? "" : "s"} selected
              </p>
            )}
          </Field>

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
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
        {hint && (
          <span className="ml-2 text-[10px] text-muted-foreground/70 font-normal">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Combo recommendations                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

type Recommendation = {
  round_key: string;
  round_label: string;
  category_a: string;
  category_b: string;
  category_a_label: string | null;
  category_b_label: string | null;
  basket_count: number;
  avg_basket_value: string;
  round_avg_basket_value: string;
  uplift_rm: string;
  example_product_a: string | null;
  example_product_b: string | null;
  already_has_combo: boolean;
};

const ROUND_TIME: Record<string, string> = {
  breakfast: "8–10am",
  brunch:    "10am–12pm",
  lunch:     "12–3pm",
  midday:    "3–5pm",
  evening:   "5–7pm",
  dinner:    "7–9pm",
  supper:    "9–11pm",
};

function ComboRecommendations({ onApplied }: { onApplied: () => void }) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [discountByKey, setDiscountByKey] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/promotions/recommendations", {
        credentials: "include",
      });
      const data = await res.json();
      setRecs(Array.isArray(data.recommendations) ? data.recommendations : []);
    } catch {
      setRecs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function apply(rec: Recommendation) {
    const key = `${rec.round_key}-${rec.category_a}-${rec.category_b}`;
    const discount_value = discountByKey[key] ?? 2;
    setApplyingKey(key);
    try {
      const res = await fetch("/api/loyalty/promotions/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          round_key: rec.round_key,
          category_a: rec.category_a,
          category_b: rec.category_b,
          discount_value,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed: ${err.error ?? res.statusText}`);
        return;
      }
      onApplied();
      load();
    } finally {
      setApplyingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="w-4 h-4" />
          Mining basket history for combo ideas…
        </div>
      </div>
    );
  }

  if (recs.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2 text-amber-900">
            <Sparkles className="w-4 h-4" />
            Suggested combos
            <span className="text-xs font-normal text-amber-800/70">
              ({recs.length} ideas from POS history)
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Mined from 6 months of StoreHub baskets. Each suggestion shows the round,
            the categories that already pair organically, and the AOV uplift you&apos;d see if you nudged the rest with a combo.
            Click <strong>Apply</strong> to create the combo with one tap.
          </p>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? "Show all" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {recs.map((rec) => {
            const key = `${rec.round_key}-${rec.category_a}-${rec.category_b}`;
            const discount = discountByKey[key] ?? 2;
            const isApplying = applyingKey === key;
            const upliftRm = Number(rec.uplift_rm);
            const upliftPositive = upliftRm > 0;
            return (
              <div key={key} className="rounded-xl border bg-card p-4 space-y-3">
                {/* Round chip */}
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                    <Clock className="w-3 h-3" />
                    {rec.round_label} · {ROUND_TIME[rec.round_key]}
                  </span>
                  {upliftPositive && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-700">
                      <TrendingUp className="w-3 h-3" />
                      +RM{upliftRm.toFixed(2)} AOV
                    </span>
                  )}
                </div>

                {/* Categories pair */}
                <div>
                  <div className="font-semibold text-sm">
                    {rec.category_a_label ?? rec.category_a}
                    <span className="mx-1.5 text-muted-foreground">+</span>
                    {rec.category_b_label ?? rec.category_b}
                  </div>
                  {(rec.example_product_a || rec.example_product_b) && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      e.g. {rec.example_product_a} + {rec.example_product_b}
                    </div>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Baskets / 6mo</div>
                    <div className="font-semibold tabular-nums">{rec.basket_count.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Avg basket</div>
                    <div className="font-semibold tabular-nums">RM{Number(rec.avg_basket_value).toFixed(2)}</div>
                  </div>
                </div>

                {/* Apply controls */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                  <label className="text-xs text-muted-foreground shrink-0">RM off:</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={discount}
                    onChange={(e) =>
                      setDiscountByKey({ ...discountByKey, [key]: Number(e.target.value) || 0 })
                    }
                    className="w-16 px-2 py-1 rounded border bg-background text-sm tabular-nums"
                  />
                  <button
                    onClick={() => apply(rec)}
                    disabled={isApplying || discount <= 0}
                    className="ml-auto px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isApplying ? "Creating…" : "Apply"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
