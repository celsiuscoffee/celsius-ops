"use client";

import { useState, useEffect } from "react";
import { Ticket, Plus, Pencil, Trash2, X } from "lucide-react";

type Category = "free_item" | "upgrade" | "discount" | "multiplier" | "special";

interface VoucherTemplate {
  id: string;
  brand_id: string;
  title: string;
  description: string;
  icon: string;
  category: Category;
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  multiplier_value: number | null;
  min_order_value: number | null;
  validity_days: number;
  stacks_with_beans: boolean;
  stacks_with_other: boolean;
  is_active: boolean;
  /** Optional link to an Outcome Type. When set, the native voucher
   *  card uses the kind's color/illustration_url as a per-voucher
   *  visual override on top of the source-bucket theme. */
  reward_kind_id: string | null;
}

interface RewardKindOption {
  id: string;
  label: string;
  color: string | null;
}

const BRAND_ID = "brand-celsius";

const CATEGORY_LABELS: Record<Category, string> = {
  free_item: "Free Item",
  upgrade:   "Add-on",            // Celsius offers add-ons (extra shot, oat milk, syrup) — never size upgrades
  discount:  "Discount",
  multiplier: "Multiplier",
  special:   "Special",
};

const CATEGORY_STYLES: Record<Category, string> = {
  free_item: "bg-emerald-500/10 text-emerald-400",
  upgrade:   "bg-sky-500/10 text-sky-400",
  discount:  "bg-amber-500/10 text-amber-400",
  multiplier: "bg-violet-500/10 text-violet-400",
  special:   "bg-rose-500/10 text-rose-400",
};

export default function VoucherTemplatesPage() {
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [kinds, setKinds] = useState<RewardKindOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<VoucherTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tplRes, kindsRes] = await Promise.all([
        fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" }),
        fetch(`/api/loyalty/reward-kinds`, { credentials: "include" }),
      ]);
      setTemplates(await tplRes.json());
      const kindRows = await kindsRes.json();
      setKinds(Array.isArray(kindRows) ? kindRows.filter((k) => k.is_active) : []);
    } catch { setTemplates([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/loyalty/voucher-templates?id=${id}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Ticket className="w-6 h-6" />
            Voucher Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every voucher shape that can land in a customer's wallet. Channels (Challenges, Mystery,
            Birthday, Referrals, Admin Claimables) issue instances from these templates.
            <br />
            <span className="text-xs text-muted-foreground/80">
              Different from <strong>Points Shop</strong> (rewards bought with Beans — defined under <em>Channels</em>).
            </span>
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : templates.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold truncate">{t.title}</h3>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${CATEGORY_STYLES[t.category]}`}>
                      {CATEGORY_LABELS[t.category]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
                <div>Validity: {t.validity_days} days</div>
                {t.discount_value && <div>Discount: {t.discount_value} {t.discount_type === "percent" ? "%" : "RM"}</div>}
                {t.multiplier_value && <div>Multiplier: {t.multiplier_value}×</div>}
                <div>Stacks with Beans: {t.stacks_with_beans ? "Yes" : "No"}</div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className={`text-xs ${t.is_active ? "text-emerald-500" : "text-muted-foreground"}`}>
                  {t.is_active ? "● Active" : "○ Paused"}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(t)} className="p-1.5 hover:bg-muted rounded">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(t.id)} className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <TemplateModal
          template={editing}
          kinds={kinds}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template, kinds, onClose, onSaved,
}: { template: VoucherTemplate | null; kinds: RewardKindOption[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState<Category>(template?.category ?? "free_item");
  const [discountType, setDiscountType] = useState(template?.discount_type ?? "free_item");
  const [discountValue, setDiscountValue] = useState<number>(template?.discount_value ?? 0);
  const [maxDiscountValue, setMaxDiscountValue] = useState<number>(template?.max_discount_value ?? 0);
  const [multiplierValue, setMultiplierValue] = useState<number>(template?.multiplier_value ?? 0);
  const [minOrderValue, setMinOrderValue] = useState<number>(template?.min_order_value ?? 0);
  const [validityDays, setValidityDays] = useState(template?.validity_days ?? 14);
  const [stacksBeans, setStacksBeans] = useState(template?.stacks_with_beans ?? true);
  const [stacksOther, setStacksOther] = useState(template?.stacks_with_other ?? false);
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [rewardKindId, setRewardKindId] = useState<string | "">(template?.reward_kind_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload = {
        brand_id: BRAND_ID,
        title, description, category,
        discount_type: discountType,
        discount_value: discountValue || null,
        max_discount_value: maxDiscountValue || null,
        multiplier_value: multiplierValue || null,
        min_order_value: minOrderValue || null,
        validity_days: validityDays,
        stacks_with_beans: stacksBeans,
        stacks_with_other: stacksOther,
        is_active: isActive,
        reward_kind_id: rewardKindId || null,
      };

      const res = template
        ? await fetch(`/api/loyalty/voucher-templates`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: template.id, ...payload }),
          })
        : await fetch(`/api/loyalty/voucher-templates`, {
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
      <div className="bg-card rounded-2xl w-full max-w-lg md:max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">{template ? "Edit Template" : "New Voucher Template"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="e.g. Free Pastry, Free Extra Shot, Free Oat Milk" />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Any pastry under RM10, valid on next visit" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="w-full border rounded-lg px-3 py-2 bg-background">
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Validity (days)">
              <input type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          </div>

          <Field label="Discount type">
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
              <option value="free_item">Free item</option>
              <option value="free_upgrade">Free add-on (extra shot / oat milk / syrup)</option>
              <option value="flat">Flat (RM off)</option>
              <option value="percent">Percent off</option>
              <option value="beans_multiplier">Beans multiplier</option>
              <option value="none">None</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount / Value">
              <input type="number" min={0} step={0.5} value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
            <Field label="Max discount (RM)">
              <input type="number" min={0} step={0.5} value={maxDiscountValue} onChange={(e) => setMaxDiscountValue(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Multiplier (if applicable)">
              <input type="number" min={0} step={0.5} value={multiplierValue} onChange={(e) => setMultiplierValue(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="e.g. 2 for 2× Beans" />
            </Field>
            <Field label="Min order (RM)">
              <input type="number" min={0} step={0.5} value={minOrderValue} onChange={(e) => setMinOrderValue(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </Field>
          </div>

          <div className="border rounded-lg p-3 space-y-2 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Stacking</div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={stacksBeans} onChange={(e) => setStacksBeans(e.target.checked)} />
              Stacks with Beans redemption
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={stacksOther} onChange={(e) => setStacksOther(e.target.checked)} />
              Stacks with other vouchers
            </label>
          </div>

          <div className="border rounded-lg p-3 space-y-2 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Card visual (Outcome Type)
            </div>
            <div className="text-xs text-muted-foreground">
              Optional. When set, the customer's voucher card uses this Outcome Type's colour +
              illustration as a visual override on top of the default source-bucket theme. Manage
              the palette under <em>Rewards → Setup → Outcome Types</em>.
            </div>
            <select
              value={rewardKindId}
              onChange={(e) => setRewardKindId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            >
              <option value="">— No override (use default bucket theme) —</option>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                  {k.color ? `  (${k.color})` : ""}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="text-sm">Active</span>
          </label>

          {error && <div className="text-sm text-rose-500">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-muted text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : template ? "Save changes" : "Create template"}
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
      <Ticket className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-medium mb-1">No voucher templates yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        Create templates like "Free Pastry" or "2× Beans Boost". Missions and Mystery Bean reference these to grant vouchers.
      </p>
      <button onClick={onCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium">
        <Plus className="w-4 h-4" /> Create first template
      </button>
    </div>
  );
}
