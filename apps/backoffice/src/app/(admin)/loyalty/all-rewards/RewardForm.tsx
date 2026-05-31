"use client";

// RewardForm — the "New Reward" / "Edit Reward" form.
//
// This is the TEMPLATE REGISTRY. The form defines what a voucher
// does (discount math + eligibility + theming + limits) and that's
// the entirety of its scope. Channel pages (Mystery Pool / Challenges
// / Birthday / Tier Upgrade / Admin Claimables / Manual Grant) stay
// as separate surfaces — each picks from this template registry
// when configuring its own trigger rules.
//
// In short: this form creates a voucher template. Where and when it
// fires is set up on the channel pages.

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Save, Trash2, X, Plus, Search, ExternalLink,
  Gift, Target,
} from "lucide-react";

const BRAND_ID = "brand-celsius";

export type DiscountType =
  | "flat" | "percent" | "free_item" | "free_upgrade"
  | "bogo" | "combo" | "override_price"
  | "beans_multiplier" | "none";

export type Scope = "everything" | "products" | "categories";

export type TriggerType =
  | "points_shop" | "mission" | "mystery"
  | "birthday" | "tier_upgrade" | "admin_push" | "manual_grant";

export type ProductOpt    = { id: string; name: string; category: string };
export type CategoryOpt   = { id: string; name: string };

export type FormValue = {
  id?: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  discount_type: DiscountType;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  multiplier_value: number | null;
  bogo_buy_qty: number;
  bogo_free_qty: number;
  /** combo: the bundle's fixed total in SEN (discount = bundle − this). */
  combo_price_sen: number | null;
  /** override_price: the single eligible item's fixed price in SEN. */
  override_price_sen: number | null;
  /** bogo / free_item: the specific product(s) given FREE. For BOGO this
   *  is the "get Y free" item (the scope/target_ids below are the
   *  qualifying "buy" set). Empty = free the same item that's bought. */
  free_product_ids: string[];
  /** Bean Shop cost. When set (> 0), this reward is redeemable in the
   *  customer Bean Shop for this many Beans. Blank = not a points-shop item. */
  points_cost: number | null;
  scope: Scope;
  target_ids: string[];
  modifier_filter: Record<string, string>;
  validity_days: number;
  stacks_with_beans: boolean;
  stacks_with_other: boolean;
  is_active: boolean;
  /** Read-only — channels currently referencing this template.
   *  Surfaces in the form as deep-links to the channel page so admin
   *  knows where to go to wire/unwire a trigger. Not edited here. */
  existingTriggers?: Array<{ type: TriggerType; label: string }>;
};

const EMPTY: FormValue = {
  title: "",
  description: "",
  icon: "ticket",
  category: "discount",
  discount_type: "free_item",
  discount_value: null,
  max_discount_value: null,
  min_order_value: null,
  multiplier_value: null,
  bogo_buy_qty: 1,
  bogo_free_qty: 1,
  combo_price_sen: null,
  override_price_sen: null,
  free_product_ids: [],
  points_cost: null,
  scope: "categories",
  target_ids: [],
  modifier_filter: {},
  validity_days: 30,
  stacks_with_beans: true,
  stacks_with_other: false,
  is_active: true,
  existingTriggers: [],
};

/** Channel-page deep-links — surface alongside read-only trigger
 *  chips so admin can jump straight to the right config page. */
const TRIGGER_CHANNEL_PAGE: Record<TriggerType, string> = {
  // Bean Shop is configured on THIS page now (the "Bean Shop cost" field) —
  // the standalone /loyalty/rewards page was retired, so it has no
  // deep-link (empty = render a non-clickable chip).
  points_shop:  "",
  mission:      "/loyalty/missions",
  mystery:      "/loyalty/mystery",
  birthday:     "/loyalty/birthday",
  tier_upgrade: "/loyalty/tiers",
  admin_push:   "/loyalty/admin-claimables",
  manual_grant: "/loyalty/manual-grant",
};

// Drink/food category slugs as defined on Celsius's product catalog.
// In a follow-up we'll source these from /api/loyalty/categories so
// admins editing the catalog don't desync the picker.
const CATEGORY_OPTS: CategoryOpt[] = [
  { id: "classic",        name: "Classic" },
  { id: "flavoured",      name: "Flavoured" },
  { id: "mocha",          name: "Mocha" },
  { id: "fruit-tea",      name: "Fruit Tea" },
  { id: "gourmet-tea",    name: "Gourmet Tea" },
  { id: "artisan-choc",   name: "Artisan Chocolate" },
  { id: "artisan-matcha", name: "Artisan Matcha" },
  { id: "mocktails",      name: "Mocktails" },
  { id: "pastries",       name: "Pastries" },
  { id: "sandwiches",     name: "Sandwiches" },
  { id: "cakes",          name: "Cakes" },
];

type Props = {
  mode: "create" | "edit";
  initial?: Partial<FormValue>;
};

export default function RewardForm({ mode, initial }: Props) {
  const router = useRouter();
  const [val, setVal]     = useState<FormValue>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);

  // Fetch the live catalog once so the Specific Products picker can
  // typeahead. /api/pickup/products returns { products, categories } —
  // NOT a bare array. The old code did rows.map() on the object, which
  // threw and hit the catch → the picker was always empty ("no products").
  // Mirror the Discount Engine page: read d.products, and resolve
  // category_id → category name so the dropdown groups under real labels.
  useEffect(() => {
    fetch("/api/pickup/products", { credentials: "include" })
      .then((res) => res.json())
      .then((d: {
        products?: Array<{ id: string; name: string; category_id?: string | null }>;
        categories?: Array<{ id: string; name: string }>;
      }) => {
        const catName = new Map((d.categories ?? []).map((c) => [c.id, c.name]));
        setProducts(
          (d.products ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            category: catName.get(p.category_id ?? "") ?? "Other",
          })),
        );
      })
      .catch(() => setProducts([]));
  }, []);

  function update<K extends keyof FormValue>(k: K, v: FormValue[K]) {
    setVal((p) => ({ ...p, [k]: v }));
  }
  function toggleTargetId(id: string) {
    setVal((p) => ({
      ...p,
      target_ids: p.target_ids.includes(id) ? p.target_ids.filter((x) => x !== id) : [...p.target_ids, id],
    }));
  }
  function toggleFreeProductId(id: string) {
    setVal((p) => ({
      ...p,
      free_product_ids: p.free_product_ids.includes(id)
        ? p.free_product_ids.filter((x) => x !== id)
        : [...p.free_product_ids, id],
    }));
  }

  async function onSave() {
    setError(null);
    if (!val.title.trim()) { setError("Name is required"); return; }
    if (val.scope !== "everything" && val.target_ids.length === 0) {
      setError("Pick at least one target product or category, or set Applies to Everything.");
      return;
    }
    setSaving(true);
    try {
      // Map to API body
      const body = {
        brand_id:           BRAND_ID,
        title:              val.title.trim(),
        description:        val.description.trim(),
        icon:               val.icon,
        category:           val.category,
        discount_type:      val.discount_type,
        discount_value:     val.discount_value,
        max_discount_value: val.max_discount_value,
        min_order_value:    val.min_order_value,
        multiplier_value:   val.multiplier_value,
        bogo_buy_qty:       val.bogo_buy_qty,
        bogo_free_qty:      val.bogo_free_qty,
        combo_price_sen:    val.combo_price_sen,
        override_price_sen: val.override_price_sen,
        free_product_ids:   val.free_product_ids,
        points_cost:        val.points_cost,
        scope:              val.scope,
        target_ids:         val.target_ids,
        validity_days:      val.validity_days,
        stacks_with_beans:  val.stacks_with_beans,
        stacks_with_other:  val.stacks_with_other,
        is_active:          val.is_active,
      };
      const res = await fetch(
        mode === "create" ? "/api/loyalty/all-rewards" : `/api/loyalty/all-rewards?id=${val.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.push("/loyalty/all-rewards");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onArchive() {
    if (!val.id) return;
    if (!confirm("Archive this reward? It will be paused and hidden from active filters. Existing issued vouchers remain valid.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/loyalty/all-rewards?id=${val.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to archive");
      router.push("/loyalty/all-rewards");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/loyalty/all-rewards")} className="p-2 -ml-2 text-slate-600 hover:text-slate-900">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {mode === "create" ? "New Reward" : "Edit Reward"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              One template, many triggers. Same shape as every other reward in the system.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {mode === "edit" && (
            <button onClick={onArchive} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50">
              <Trash2 className="w-4 h-4" /> Archive
            </button>
          )}
          <button onClick={() => router.push("/loyalty/all-rewards")} disabled={saving} className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* 1. Enable */}
      <Card title="Enable" sub="Reward is active and visible to customers when this is on." n={1}>
        <Switch
          checked={val.is_active}
          onChange={(v) => update("is_active", v)}
          label={val.is_active ? "Enabled" : "Paused"}
        />
      </Card>

      {/* 2. The Voucher */}
      <Card title="The Voucher" sub="What the customer actually gets. Same shape for every reward." n={2}>

        <Field label="Name" required>
          <input
            type="text"
            value={val.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. Free Drink, RM5 Off, 2× Beans Boost"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={val.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            placeholder="Optional — shown on the wallet card."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 resize-y"
          />
        </Field>

        <Field label="Discount type" required help="Drives the discount math. The canonical 9 types — every reward uses one of these.">
          <select
            value={val.discount_type}
            onChange={(e) => update("discount_type", e.target.value as DiscountType)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="free_item">Free item (cheapest eligible line)</option>
            <option value="free_upgrade">Free upgrade (cheapest add-on)</option>
            <option value="flat">Flat — RM off</option>
            <option value="percent">Percent off</option>
            <option value="bogo">Buy X get Y free (BOGO)</option>
            <option value="combo">Combo — required set, override total</option>
            <option value="override_price">Override price — single item, fixed price</option>
            <option value="beans_multiplier">Beans multiplier (post-payment)</option>
          </select>
        </Field>

        {val.discount_type === "flat" && (
          <Field label="Discount value">
            <Prefix unit="RM">
              <input
                type="number" step={0.1}
                value={val.discount_value ?? ""}
                onChange={(e) => update("discount_value", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
                placeholder="5.00"
              />
            </Prefix>
            <Help>Stored as sen on the row (e.g. 5.00 → 500).</Help>
          </Field>
        )}

        {val.discount_type === "percent" && (
          <>
            <Field label="Discount value">
              <Prefix unit="%">
                <input
                  type="number" step={1}
                  value={val.discount_value ?? ""}
                  onChange={(e) => update("discount_value", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder="15"
                />
              </Prefix>
            </Field>
            <Field label="Cap discount at" help="max_discount_value — leave blank for no cap.">
              <Prefix unit="RM">
                <input
                  type="number" step={0.1}
                  value={val.max_discount_value ? val.max_discount_value / 100 : ""}
                  onChange={(e) => update("max_discount_value", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
                  placeholder="Optional"
                />
              </Prefix>
            </Field>
          </>
        )}

        {val.discount_type === "bogo" && (
          <>
            <Field label="Buy quantity" help="How many qualifying items (the 'Applies to' set below) must be bought."><input type="number" value={val.bogo_buy_qty} onChange={(e) => update("bogo_buy_qty", Number(e.target.value))} className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg" /></Field>
            <Field label="Free quantity" help="How many free items the customer gets per qualifying group."><input type="number" value={val.bogo_free_qty} onChange={(e) => update("bogo_free_qty", Number(e.target.value))} className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg" /></Field>
            <Field label="Free item" help="What the customer gets FREE. Pick a different product for 'buy X get Y free' (e.g. buy a drink → free pastry). Leave empty to free the same item they buy. The 'Applies to' set below is the qualifying (buy) item.">
              <ProductPicker
                products={products}
                selected={val.free_product_ids}
                onToggle={toggleFreeProductId}
                onClear={() => update("free_product_ids", [])}
              />
            </Field>
          </>
        )}

        {val.discount_type === "combo" && (
          <Field label="Combo price" help="Bundle total. Discount = (one of each required product) − this. Set 'Applies to' = Specific products and pick the items that must ALL be in the cart.">
            <Prefix unit="RM">
              <input
                type="number" step={0.1}
                value={val.combo_price_sen != null ? val.combo_price_sen / 100 : ""}
                onChange={(e) => update("combo_price_sen", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
                placeholder="e.g. 12.00"
              />
            </Prefix>
            <Help>Stored as sen (e.g. 12.00 → 1200).</Help>
          </Field>
        )}

        {val.discount_type === "override_price" && (
          <Field label="Override price" help="The single eligible item is repriced to this fixed price. Use 'Applies to' below to scope which item(s) qualify.">
            <Prefix unit="RM">
              <input
                type="number" step={0.1}
                value={val.override_price_sen != null ? val.override_price_sen / 100 : ""}
                onChange={(e) => update("override_price_sen", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
                placeholder="e.g. 4.00"
              />
            </Prefix>
            <Help>Stored as sen (e.g. 4.00 → 400).</Help>
          </Field>
        )}

        {val.discount_type === "beans_multiplier" && (
          <Field label="Multiplier" help="Beans awarded post-payment, applied to the after-discount subtotal.">
            <Prefix unit="×">
              <input
                type="number" step={0.1}
                value={val.multiplier_value ?? ""}
                onChange={(e) => update("multiplier_value", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="2.0"
              />
            </Prefix>
          </Field>
        )}

        <Field label="Applies to" required help="What the reward targets. Drives the eligibility filter at checkout.">
          <Segment
            value={val.scope}
            onChange={(v) => { update("scope", v as Scope); update("target_ids", []); }}
            options={[
              { value: "everything",  label: "Everything" },
              { value: "products",    label: "Specific products" },
              { value: "categories",  label: "Categories" },
            ]}
          />
        </Field>

        {val.scope === "categories" && (
          <Field label="Target categories">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTS.map((c) => {
                const on = val.target_ids.includes(c.id);
                return (
                  <button key={c.id} onClick={() => toggleTargetId(c.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"}`}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {val.scope === "products" && (
          <Field label="Target products" help="Type to search the live catalog. Pick one or more.">
            <ProductPicker
              products={products}
              selected={val.target_ids}
              onToggle={(id) => toggleTargetId(id)}
              onClear={() => update("target_ids", [])}
            />
          </Field>
        )}

        <Field label="Modifier filter" help="Optional. Only match cart lines whose modifiers contain ALL these key:value pairs. Today Celsius only has add-ons (no size/milk groups) — leave blank unless you're adding a new modifier group.">
          <ModifierFilterEditor
            value={val.modifier_filter}
            onChange={(mf) => update("modifier_filter", mf)}
          />
        </Field>

        <Field label="Min order value" help="Cart subtotal must be ≥ this for the reward to fire.">
          <Prefix unit="RM">
            <input
              type="number" step={0.1}
              value={val.min_order_value ? val.min_order_value / 100 : ""}
              onChange={(e) => update("min_order_value", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
              placeholder="Blank = no minimum"
            />
          </Prefix>
        </Field>

        <Field label="Bean Shop cost" help="Beans the customer spends to redeem this in the Bean Shop. Leave blank if it isn't a points-shop item. (Replaces the old Points Shop page — Bean Shop rewards are configured here now.)">
          <input
            type="number" step={1} min={0}
            value={val.points_cost ?? ""}
            onChange={(e) => update("points_cost", e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))}
            placeholder="Blank = not in Bean Shop"
            className="w-40 px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </Field>
      </Card>

      {/* 3. Used by — read-only chips showing which channels reference this template.
            Edits happen on the channel pages, not here. */}
      {mode === "edit" && val.existingTriggers && val.existingTriggers.length > 0 && (
        <Card title="Used by" sub="Channels currently referencing this reward. Edit the trigger config on each channel's page." n={3}>
          <div className="space-y-2">
            {val.existingTriggers.map((t, i) => {
              const page = TRIGGER_CHANNEL_PAGE[t.type];
              const icon = (
                <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  {t.type === "mystery"  && <Gift className="w-4 h-4 text-yellow-700" />}
                  {t.type === "mission"  && <Target className="w-4 h-4 text-emerald-700" />}
                  {t.type !== "mystery" && t.type !== "mission" && <Search className="w-4 h-4 text-slate-500" />}
                </span>
              );
              // No channel page (Bean Shop) → non-clickable chip, since
              // it's configured here via the Bean Shop cost field.
              if (!page) {
                return (
                  <div key={i} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50/50">
                    {icon}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{t.label}</div>
                      <div className="text-xs text-slate-500">Configured on this page — see “Bean Shop cost”.</div>
                    </div>
                  </div>
                );
              }
              return (
                <Link
                  key={i}
                  href={page}
                  className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                >
                  {icon}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{t.label}</div>
                    <div className="text-xs text-slate-500">{page}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* Limits */}
      <Card title="Limits" sub="Validity + stacking rules." n={mode === "edit" && val.existingTriggers && val.existingTriggers.length > 0 ? 4 : 3}>
        <Field label="Voucher expiry" help="How long the issued voucher stays in the customer's wallet.">
          <Prefix unit="days">
            <input type="number" value={val.validity_days} onChange={(e) => update("validity_days", Number(e.target.value))} />
          </Prefix>
        </Field>
        <Field label="Stacks with beans">
          <Switch
            checked={val.stacks_with_beans}
            onChange={(v) => update("stacks_with_beans", v)}
            label="Earn beans on the discounted subtotal"
          />
        </Field>
        <Field label="Stacks with other vouchers">
          <Switch
            checked={val.stacks_with_other}
            onChange={(v) => update("stacks_with_other", v)}
            label="Can be combined with other reward vouchers"
          />
        </Field>
      </Card>

    </div>
  );
}

// ─── Generic form bits ──────────────────────────────────────────

function Card({ title, sub, n, children }: { title: string; sub?: string; n: number; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl mb-3 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          {n}
        </div>
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
        </div>
      </div>
      <div className="px-5 py-3 space-y-3.5">{children}</div>
    </div>
  );
}

function Field({ label, required, help, children }: { label: string; required?: boolean; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-start">
      <div className="pt-2">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
        </div>
      </div>
      <div>
        {children}
        {help && <div className="text-[11px] text-slate-500 mt-1">{help}</div>}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label, small = false }: { checked: boolean; onChange: (v: boolean) => void; label?: string; small?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer">
      <span className={`relative inline-block ${small ? "w-9 h-5" : "w-10 h-6"} rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 ${small ? "w-4 h-4" : "w-5 h-5"} bg-white rounded-full transition transform shadow-sm ${checked ? (small ? "left-4" : "left-4") : "left-0.5"}`} />
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </label>
  );
}

function Segment({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex bg-slate-100 rounded-full p-1 gap-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-xs font-semibold rounded-full transition ${value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Prefix({ unit, children }: { unit: string; children: React.ReactElement }) {
  return (
    <div className="inline-flex items-stretch border border-slate-200 rounded-lg overflow-hidden bg-white">
      <span className="px-3 flex items-center text-xs font-semibold text-slate-500 bg-slate-50 border-r border-slate-200">{unit}</span>
      <span className="contents">{children}</span>
      <style jsx>{`:global(.contents > input) { border: none !important; outline: none; padding: 0.5rem 0.75rem; font-size: 0.875rem; width: 8rem; }`}</style>
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-slate-500 mt-1">{children}</div>;
}

// ─── Product picker ────────────────────────────────────────────────
function ProductPicker({ products, selected, onToggle, onClear }: { products: ProductOpt[]; selected: string[]; onToggle: (id: string) => void; onClear: () => void }) {
  const [q, setQ]      = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Group products by category for the dropdown
  const grouped = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = products.filter((p) => !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term));
    const map = new Map<string, ProductOpt[]>();
    for (const p of filtered) {
      const cat = p.category || "Uncategorised";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [products, q]);

  return (
    <div className="space-y-2 relative">
      {/* Selected chips */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {selected.length === 0 ? (
          <div className="text-xs text-slate-400 italic">No products selected.</div>
        ) : (
          <>
            {selected.map((id) => {
              const p = byId.get(id);
              return (
                <span key={id} className="inline-flex items-center gap-1 bg-slate-900 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                  {p ? p.name : id}
                  <button onClick={() => onToggle(id)} className="opacity-70 hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            <button onClick={onClear} className="text-[11px] text-slate-400 hover:text-slate-700 px-2 py-1">Clear all</button>
          </>
        )}
      </div>

      {/* Search + dropdown */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type to search products…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
        />
        {open && grouped.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 sticky top-0">
                  {cat} · {items.length}
                </div>
                {items.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggle(p.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center justify-between ${on ? "bg-emerald-50 text-emerald-900" : "text-slate-700"}`}
                    >
                      <span>{p.name}</span>
                      {on && <span className="text-emerald-600 text-xs">✓ selected</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {open && grouped.length === 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs text-slate-500">
            No products match &quot;{q}&quot;.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modifier filter editor ───────────────────────────────────────
// Renders the `modifier_filter` jsonb as a list of key:value pairs.
// Add row with the + button, remove with the × button.
function ModifierFilterEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value);
  const [pendingKey, setPendingKey] = useState("");
  const [pendingVal, setPendingVal] = useState("");

  function addPair() {
    if (!pendingKey.trim()) return;
    onChange({ ...value, [pendingKey.trim()]: pendingVal.trim() });
    setPendingKey("");
    setPendingVal("");
  }
  function removePair(k: string) {
    const next = { ...value };
    delete next[k];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <div className="text-xs text-slate-400 italic">No modifier filters — reward applies regardless of modifiers.</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <code className="text-xs font-semibold text-slate-900">{k}</code>
              <span className="text-slate-400">:</span>
              <code className="text-xs text-slate-700">&quot;{v}&quot;</code>
              <button onClick={() => removePair(k)} className="ml-auto text-slate-400 hover:text-rose-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={pendingKey}
          onChange={(e) => setPendingKey(e.target.value)}
          placeholder="modifier key (e.g. size)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
        />
        <input
          type="text"
          value={pendingVal}
          onChange={(e) => setPendingVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addPair(); }}
          placeholder="required value (e.g. large)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
        />
        <button onClick={addPair} className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  );
}
