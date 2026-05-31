"use client";

// RewardForm — the unified "New Reward" / "Edit Reward" form.
//
// One form covers: the canonical voucher template (9 discount types,
// scope/target_ids eligibility, modifier filter, type-specific knobs,
// limits) PLUS optional trigger config for the 3 channels we can write
// to today (Mystery / Mission / Admin Push). The remaining 4 channels
// (Bean Shop / Birthday / Tier Upgrade / Manual Grant) surface as
// deferred chips with a deep-link to the existing channel page — they
// land properly when the trigger consolidation (Commit 4 of the
// refactor) replaces the per-channel tables.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, Save, Trash2,
  Coins, Target, Gift, Cake, Crown, Megaphone, Hand,
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
  // template
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
  scope: Scope;
  target_ids: string[];
  modifier_filter: Record<string, string>;
  validity_days: number;
  stacks_with_beans: boolean;
  stacks_with_other: boolean;
  is_active: boolean;
  // triggers
  triggers: Partial<Record<TriggerType, Record<string, unknown>>>;
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
  scope: "categories",
  target_ids: [],
  modifier_filter: {},
  validity_days: 30,
  stacks_with_beans: true,
  stacks_with_other: false,
  is_active: true,
  triggers: {},
};

const TRIGGER_META: Record<TriggerType, { label: string; tagline: string; icon: typeof Coins; writeSupported: boolean; channelPage?: string }> = {
  points_shop:   { label: "Spend Beans (Bean Points Shop)", tagline: "Customer redeems with their beans balance.", icon: Coins,     writeSupported: false, channelPage: "/loyalty/rewards" },
  mission:       { label: "Complete a Challenge",            tagline: "Auto-issued when member hits a progress goal.", icon: Target,    writeSupported: true },
  mystery:       { label: "Mystery Drop",                    tagline: "Random drop on every order, weighted.",          icon: Gift,      writeSupported: true },
  birthday:      { label: "On Birthday",                     tagline: "Cron drops in wallet on member's birthday.",     icon: Cake,      writeSupported: false, channelPage: "/loyalty/birthday" },
  tier_upgrade:  { label: "On Tier Upgrade",                 tagline: "Awarded when member crosses to specific tier.",  icon: Crown,     writeSupported: false, channelPage: "/loyalty/tiers" },
  admin_push:    { label: "Admin Push (Claimable)",          tagline: "Queue for an audience; customer claims it.",     icon: Megaphone, writeSupported: true },
  manual_grant:  { label: "Manual Grant Only",               tagline: "No auto-issue. Admin grants directly per member.", icon: Hand,    writeSupported: true },
};

const TRIGGER_ORDER: TriggerType[] = ["points_shop", "mission", "mystery", "birthday", "tier_upgrade", "admin_push", "manual_grant"];

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

  function update<K extends keyof FormValue>(k: K, v: FormValue[K]) {
    setVal((p) => ({ ...p, [k]: v }));
  }
  function toggleTrigger(t: TriggerType) {
    setVal((p) => {
      const next = { ...p.triggers };
      if (t in next) { delete next[t]; }
      else { next[t] = defaultTriggerConfig(t); }
      return { ...p, triggers: next };
    });
  }
  function updateTrigger(t: TriggerType, key: string, v: unknown) {
    setVal((p) => ({ ...p, triggers: { ...p.triggers, [t]: { ...(p.triggers[t] ?? {}), [key]: v } } }));
  }
  function toggleTargetId(id: string) {
    setVal((p) => ({
      ...p,
      target_ids: p.target_ids.includes(id) ? p.target_ids.filter((x) => x !== id) : [...p.target_ids, id],
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
        scope:              val.scope,
        target_ids:         val.target_ids,
        validity_days:      val.validity_days,
        stacks_with_beans:  val.stacks_with_beans,
        stacks_with_other:  val.stacks_with_other,
        is_active:          val.is_active,
        triggers: mode === "create" ? val.triggers : undefined,  // trigger writes only on create
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
            <Field label="Buy quantity"><input type="number" value={val.bogo_buy_qty} onChange={(e) => update("bogo_buy_qty", Number(e.target.value))} className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg" /></Field>
            <Field label="Free quantity"><input type="number" value={val.bogo_free_qty} onChange={(e) => update("bogo_free_qty", Number(e.target.value))} className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg" /></Field>
          </>
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
          <Field label="Target products" help="Product picker pending — paste product IDs comma-separated for now.">
            <input
              type="text"
              value={val.target_ids.join(", ")}
              onChange={(e) => update("target_ids", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="prod-abc, prod-xyz"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
            />
          </Field>
        )}

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
      </Card>

      {/* 3. Triggers */}
      <Card title="How customers earn it" sub="Pick one or more. One template, many triggers." n={3}>
        <div className="space-y-2">
          {TRIGGER_ORDER.map((t) => {
            const meta = TRIGGER_META[t];
            const Icon = meta.icon;
            const on = t in val.triggers;
            const isSupported = meta.writeSupported;
            return (
              <div key={t} className={`border rounded-lg ${on ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"} transition`}>
                <button onClick={() => toggleTrigger(t)} disabled={mode === "edit"} className="w-full flex items-start gap-3 p-3 text-left">
                  <span className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${on ? "bg-slate-900 border-slate-900" : "border-slate-300"}`}>
                    {on && <span className="text-white text-[11px] font-bold">✓</span>}
                  </span>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? "bg-amber-200/60" : "bg-slate-100"}`}>
                    <Icon className={`w-4 h-4 ${on ? "text-amber-800" : "text-slate-500"}`} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                      {meta.label}
                      {!isSupported && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          Configure separately
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{meta.tagline}</div>
                  </span>
                </button>
                {on && isSupported && mode === "create" && (
                  <div className="px-3 pb-3 pl-14 space-y-2">
                    <TriggerConfig type={t} value={val.triggers[t] ?? {}} onChange={(k, v) => updateTrigger(t, k, v)} />
                  </div>
                )}
                {on && !isSupported && (
                  <div className="px-3 pb-3 pl-14 text-xs text-slate-600">
                    {meta.channelPage ? (
                      <>Trigger writes for this channel land with the trigger-consolidation refactor.
                      Configure in <a href={meta.channelPage} className="text-indigo-600 font-semibold underline">{meta.channelPage}</a> meanwhile.</>
                    ) : (
                      <>No setup needed. Any active template is grantable from the Manual Grant page.</>
                    )}
                  </div>
                )}
                {mode === "edit" && on && (
                  <div className="px-3 pb-3 pl-14 text-xs text-slate-500 italic">
                    Trigger config is locked during edit. Delete the trigger row from the channel page if you need to remove or reconfigure.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Limits */}
      <Card title="Limits" sub="Validity + stacking rules." n={4}>
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

// ─── Default per-trigger config ─────────────────────────────────
function defaultTriggerConfig(t: TriggerType): Record<string, unknown> {
  switch (t) {
    case "mystery":    return { weight: 5, min_tier: null, birthday_month_boost: false, outcome_type: "voucher" };
    case "mission":    return { title: "", description: "", difficulty: "medium", goal: { type: "spend_rm", value: 30, period: "weekly" }, cooldown_weeks: 2 };
    case "admin_push": return { title: "", description: "", audience_label: "", min_tier: null, max_claims: null, member_ids: [] };
    default:           return {};
  }
}

// ─── Trigger config sub-forms ───────────────────────────────────
function TriggerConfig({ type, value, onChange }: { type: TriggerType; value: Record<string, unknown>; onChange: (key: string, v: unknown) => void }) {
  if (type === "mystery") {
    const v = value as { weight?: number; min_tier?: string | null; birthday_month_boost?: boolean };
    return (
      <>
        <TriggerRow label="Weight" help="Higher = more likely to drop. Most pools use 1–20.">
          <input type="number" value={v.weight ?? 5} onChange={(e) => onChange("weight", Number(e.target.value))} className="w-24 px-2.5 py-1.5 text-sm border border-slate-200 rounded" />
        </TriggerRow>
        <TriggerRow label="Min tier">
          <select value={v.min_tier ?? ""} onChange={(e) => onChange("min_tier", e.target.value || null)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white">
            <option value="">Any</option>
            <option value="bronze">Bronze+</option>
            <option value="silver">Silver+</option>
            <option value="gold">Gold+</option>
            <option value="platinum">Platinum+</option>
          </select>
        </TriggerRow>
        <TriggerRow label="Birthday boost">
          <Switch checked={!!v.birthday_month_boost} onChange={(b) => onChange("birthday_month_boost", b)} label="Higher weight during member's birthday week" small />
        </TriggerRow>
      </>
    );
  }
  if (type === "mission") {
    const v = value as { title?: string; description?: string; difficulty?: string; goal?: { type?: string; value?: number; period?: string }; cooldown_weeks?: number };
    const g = v.goal ?? { type: "spend_rm", value: 30, period: "weekly" };
    return (
      <>
        <TriggerRow label="Mission title"><input type="text" value={v.title ?? ""} onChange={(e) => onChange("title", e.target.value)} placeholder="Weekly Regular" className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Mission description"><input type="text" value={v.description ?? ""} onChange={(e) => onChange("description", e.target.value)} placeholder="Spend RM30 in a week" className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Goal type">
          <select value={g.type ?? "spend_rm"} onChange={(e) => onChange("goal", { ...g, type: e.target.value })} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white">
            <option value="spend_rm">Spend RM</option>
            <option value="order_count">Place N orders</option>
            <option value="distinct_outlets">Visit N distinct outlets</option>
          </select>
        </TriggerRow>
        <TriggerRow label="Goal value"><input type="number" value={g.value ?? 30} onChange={(e) => onChange("goal", { ...g, value: Number(e.target.value) })} className="w-32 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Period">
          <select value={g.period ?? "weekly"} onChange={(e) => onChange("goal", { ...g, period: e.target.value })} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </TriggerRow>
        <TriggerRow label="Difficulty">
          <select value={v.difficulty ?? "medium"} onChange={(e) => onChange("difficulty", e.target.value)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </TriggerRow>
        <TriggerRow label="Cooldown (weeks)" help="After completion, member can't pick this challenge again for N weeks."><input type="number" value={v.cooldown_weeks ?? 2} onChange={(e) => onChange("cooldown_weeks", Number(e.target.value))} className="w-24 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
      </>
    );
  }
  if (type === "admin_push") {
    const v = value as { title?: string; description?: string; audience_label?: string; min_tier?: string | null; max_claims?: number | null };
    return (
      <>
        <TriggerRow label="Claimable title"><input type="text" value={v.title ?? ""} onChange={(e) => onChange("title", e.target.value)} placeholder="e.g., Welcome Back!" className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Description"><input type="text" value={v.description ?? ""} onChange={(e) => onChange("description", e.target.value)} className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Audience label" help="Free-text — e.g. 'VIP tier' or 'New Members'."><input type="text" value={v.audience_label ?? ""} onChange={(e) => onChange("audience_label", e.target.value)} className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
        <TriggerRow label="Min tier">
          <select value={v.min_tier ?? ""} onChange={(e) => onChange("min_tier", e.target.value || null)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded bg-white">
            <option value="">Any</option>
            <option value="bronze">Bronze+</option>
            <option value="silver">Silver+</option>
            <option value="gold">Gold+</option>
            <option value="platinum">Platinum+</option>
          </select>
        </TriggerRow>
        <TriggerRow label="Max claims" help="Cap on total claims (across all members). Blank = unlimited."><input type="number" value={v.max_claims ?? ""} onChange={(e) => onChange("max_claims", e.target.value === "" ? null : Number(e.target.value))} className="w-32 px-2.5 py-1.5 text-sm border border-slate-200 rounded" /></TriggerRow>
      </>
    );
  }
  return null;
}

function TriggerRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 flex-shrink-0">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
        {help && <div className="text-[11px] text-slate-400 mt-0.5">{help}</div>}
      </div>
      <div className="flex-1">{children}</div>
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
